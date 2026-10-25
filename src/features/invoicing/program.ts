import { and, desc, eq, sql } from 'drizzle-orm'
import { Clock, Effect, Exit } from 'effect'
import { creditNote, creditNoteLine, invoice, invoiceLine, lease, payment } from '#/db/schema'
import { loadSettings } from '#/features/settings/program'
import { sellerDetails } from '#/features/settings/seller'
import { formatSek } from '#/lib/money'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { sendEmail } from '#/server/mail/mailer'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { type CreditProblem, draftCreditNote } from './credit'
import { matchesFilter } from './overview'
import {
  dueDate,
  invoicePeriod,
  invoiceStatus,
  ocrFor,
  periodLabel,
  rentForPeriod,
  rentLineDescription,
  VAT_RATE_PERCENT,
  vatFor,
} from './rules'
import type {
  CreateCreditNoteInput,
  CreateInvoiceRunInput,
  ListInvoicesInput,
  MarkPaidInput,
} from './schemas'

const read: Permissions = { invoice: ['read'] }
const manage: Permissions = { invoice: ['manage'] }
/** A run reads every lease, so it also needs to be allowed to read leases. */
const runInvoices: Permissions = { invoice: ['manage'], lease: ['read'] }

// ---------------------------------------------------------------------------------------------
// Invoice runs

/** What a run for `month` would invoice. Leases already invoiced for the period are flagged. */
export const previewInvoiceRun = (month: string) =>
  Effect.gen(function* () {
    yield* requirePermission(runInvoices)
    const issueDate = yield* today
    const settings = yield* loadSettings

    const leases = yield* orgQuery((db, organizationId) =>
      db.query.lease.findMany({
        where: eq(lease.organizationId, organizationId),
        orderBy: lease.number,
        with: {
          tenant: true,
          units: { with: { unit: { with: { property: { columns: { designation: true } } } } } },
        },
      }),
    )
    // Every period in a run starts on the first of the month, whatever the invoice interval.
    const periodStart = `${month}-01`
    const invoiced = yield* orgQuery((db, organizationId) =>
      db
        .select({ leaseId: invoice.leaseId })
        .from(invoice)
        .where(
          and(eq(invoice.organizationId, organizationId), eq(invoice.periodStart, periodStart)),
        ),
    )
    const alreadyInvoiced = new Set(invoiced.map((i) => i.leaseId))

    const rows = leases.flatMap((l) => {
      const period = invoicePeriod(month, l.invoiceInterval)
      if (!period) return []
      const netOre = rentForPeriod(l, period)
      if (netOre <= 0) return []
      const vatOre = vatFor(netOre, l.vat)
      return [
        {
          leaseId: l.id,
          leaseNumber: l.number,
          tenant: l.tenant,
          period,
          description: rentLineDescription(
            l.units.map(({ unit }) => ({
              designation: unit.property.designation,
              label: unit.label,
            })),
            period,
          ),
          netOre,
          vatOre,
          totalOre: netOre + vatOre,
          dueDate: dueDate(period, issueDate),
          alreadyInvoiced: alreadyInvoiced.has(l.id),
        },
      ]
    })

    return { month, issueDate, canInvoice: settings.bankgiro !== null, rows }
  })

export type InvoiceRunPreview = Effect.Success<ReturnType<typeof previewInvoiceRun>>

/** D1 caps statements per batch; each invoice needs two. Each chunk is atomic on its own. */
const CHUNK_SIZE = 25

export const createInvoiceRun = (input: CreateInvoiceRunInput) =>
  Effect.gen(function* () {
    yield* requirePermission(runInvoices)
    const preview = yield* previewInvoiceRun(input.month)
    if (!preview.canInvoice) {
      return yield* new Conflict({
        message: 'Ange bankgironummer under Inställningar innan du skapar avier.',
      })
    }
    const pending = preview.rows.filter((r) => !r.alreadyInvoiced)

    const [{ maxNumber }] = yield* orgQuery((db, organizationId) =>
      db
        .select({ maxNumber: sql<number>`coalesce(max(${invoice.number}), 0)` })
        .from(invoice)
        .where(eq(invoice.organizationId, organizationId)),
    )

    // Numbers are allocated up front so they run without gaps. A concurrent run makes a chunk fail
    // on the unique number index; nothing partial is written and running again is safe.
    const createdIds: string[] = []
    for (let offset = 0; offset < pending.length; offset += CHUNK_SIZE) {
      const chunk = pending.slice(offset, offset + CHUNK_SIZE).map((row, i) => {
        const number = maxNumber + offset + i + 1
        return { row, number, id: crypto.randomUUID() }
      })
      yield* orgQuery((db, organizationId) => {
        const statements = chunk.flatMap(({ row, number, id }) => [
          db.insert(invoice).values({
            id,
            organizationId,
            number,
            ocr: ocrFor(number),
            leaseId: row.leaseId,
            tenantId: row.tenant.id,
            recipientName: row.tenant.name,
            recipientStreetAddress: row.tenant.streetAddress,
            recipientPostalCode: row.tenant.postalCode,
            recipientCity: row.tenant.city,
            recipientEmail: row.tenant.email,
            periodStart: row.period.start,
            periodEnd: row.period.end,
            issueDate: preview.issueDate,
            dueDate: row.dueDate,
            netOre: row.netOre,
            vatOre: row.vatOre,
            totalOre: row.totalOre,
          }),
          db.insert(invoiceLine).values({
            invoiceId: id,
            organizationId,
            position: 1,
            description: row.description,
            netOre: row.netOre,
            vatRatePercent: row.vatOre > 0 ? VAT_RATE_PERCENT : 0,
            vatOre: row.vatOre,
          }),
        ])
        const [first, ...rest] = statements
        return db.batch([first, ...rest])
      })
      createdIds.push(...chunk.map((c) => c.id))
    }

    const withEmail = pending.filter((r) => r.tenant.email).length
    let sent = 0
    const failedInvoiceIds: string[] = []
    if (input.send && createdIds.length > 0) {
      // A handful at a time; one failure does not stop the others.
      const results = yield* Effect.forEach(
        createdIds,
        (id) => Effect.exit(emailInvoice(id, { skipWithoutEmail: true })),
        { concurrency: 4 },
      )
      for (const [index, result] of results.entries()) {
        if (Exit.isFailure(result)) {
          failedInvoiceIds.push(createdIds[index])
          yield* Effect.logError(result.cause)
        } else if (result.value) sent++
      }
    }

    return {
      created: createdIds.length,
      skipped: preview.rows.length - pending.length,
      sent,
      failed: failedInvoiceIds.length,
      failedInvoiceIds,
      withoutEmail: pending.length - withEmail,
    }
  })

// ---------------------------------------------------------------------------------------------
// Reading invoices

const toView = <R extends typeof invoice.$inferSelect>(row: R, on: string) => ({
  ...row,
  status: invoiceStatus(row, on),
})

export const listInvoices = (input: ListInvoicesInput) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    // The lease's current units label each row; only for those who may read leases and units.
    const showUnits = yield* hasPermission({ lease: ['read'], property: ['read'] })
    const rows = yield* orgQuery((db, organizationId) =>
      db.query.invoice.findMany({
        where: and(
          eq(invoice.organizationId, organizationId),
          input.leaseId ? eq(invoice.leaseId, input.leaseId) : undefined,
        ),
        orderBy: desc(invoice.number),
        with: {
          lease: {
            columns: { id: true },
            with: {
              units: {
                with: {
                  unit: {
                    columns: { kind: true, label: true },
                    with: { property: { columns: { designation: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    )
    const on = yield* today
    const views = rows.map(({ lease: leaseRow, ...row }) => ({
      ...toView(row, on),
      units: showUnits
        ? leaseRow.units.map(({ unit }) => ({
            kind: unit.kind,
            label: unit.label,
            designation: unit.property.designation,
          }))
        : [],
    }))
    return views.filter((v) => matchesFilter(v.status, input.filter))
  })

export const getInvoice = (invoiceId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    const row = yield* orgQuery((db, organizationId) =>
      db.query.invoice.findFirst({
        where: and(eq(invoice.id, invoiceId), eq(invoice.organizationId, organizationId)),
        with: {
          lines: { orderBy: invoiceLine.position },
          lease: { columns: { id: true, number: true } },
          creditNotes: {
            columns: { id: true, number: true, issueDate: true, totalOre: true, reason: true },
            orderBy: creditNote.number,
          },
          payments: {
            columns: {
              id: true,
              bookingDate: true,
              amountOre: true,
              payerName: true,
              status: true,
              marksInvoicePaid: true,
            },
          },
        },
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'invoice', id: invoiceId })
    const seller = yield* loadSettings
    // Bank payments are listed only for those who may read payments.
    const payments = (yield* hasPermission({ payment: ['read'] })) ? row.payments : []
    return { ...toView(row, yield* today), payments, seller }
  })

export type InvoiceView = Effect.Success<ReturnType<typeof getInvoice>>

// ---------------------------------------------------------------------------------------------
// Sending and payments

/**
 * Emails one invoice to its recipient and records when it was sent. Returns false when the
 * tenant has no email address and `skipWithoutEmail` is set.
 */
export const emailInvoice = (invoiceId: string, options: { skipWithoutEmail?: boolean } = {}) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const inv = yield* getInvoice(invoiceId)
    if (inv.status === 'void') {
      return yield* new Conflict({ message: 'En makulerad avi kan inte skickas' })
    }
    if (inv.status === 'credited') {
      return yield* new Conflict({ message: 'En krediterad avi kan inte skickas' })
    }
    if (!inv.recipientEmail) {
      if (options.skipWithoutEmail) return false
      return yield* new Conflict({ message: 'Hyresgästen har ingen e-postadress' })
    }
    if (!inv.seller.bankgiro) {
      return yield* new Conflict({ message: 'Ange bankgironummer under Inställningar först' })
    }

    yield* sendEmail({
      to: inv.recipientEmail,
      template: 'rentInvoice',
      props: {
        recipientName: inv.recipientName,
        organizationName: inv.seller.organizationName,
        invoiceNumber: inv.number,
        periodLabel: periodLabel({ start: inv.periodStart, end: inv.periodEnd }),
        lines: inv.lines.map((l) => ({ description: l.description, amount: formatSek(l.netOre) })),
        net: formatSek(inv.netOre),
        vat: inv.vatOre > 0 ? formatSek(inv.vatOre) : null,
        total: formatSek(inv.totalOre),
        dueDate: inv.dueDate,
        bankgiro: inv.seller.bankgiro,
        ocr: inv.ocr,
        sellerDetails: sellerDetails(inv.seller, inv.vatOre > 0),
      },
    })

    const sentAt = new Date(yield* Clock.currentTimeMillis)
    yield* orgQuery((db, organizationId) =>
      db
        .update(invoice)
        .set({ sentAt })
        .where(and(eq(invoice.id, inv.id), eq(invoice.organizationId, organizationId))),
    )
    return true
  })

const updateInvoice = (invoiceId: string, values: Partial<typeof invoice.$inferInsert>) =>
  orgQuery((db, organizationId) =>
    db
      .update(invoice)
      .set(values)
      .where(and(eq(invoice.id, invoiceId), eq(invoice.organizationId, organizationId))),
  )

export const markInvoicePaid = (input: MarkPaidInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const inv = yield* getInvoice(input.invoiceId)
    if (inv.status === 'void') return yield* new Conflict({ message: 'Avin är makulerad' })
    if (inv.status === 'paid') return yield* new Conflict({ message: 'Avin är redan betald' })
    if (inv.status === 'credited') return yield* new Conflict({ message: 'Avin är krediterad' })
    if (input.paidOn > (yield* today)) {
      return yield* new Conflict({ message: 'Betaldatum kan inte vara i framtiden' })
    }
    yield* updateInvoice(inv.id, { paidOn: input.paidOn })
    return yield* getInvoice(inv.id)
  })

export const unmarkInvoicePaid = (invoiceId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const inv = yield* getInvoice(invoiceId)
    if (inv.status !== 'paid') return yield* new Conflict({ message: 'Avin är inte betald' })
    // A bank payment that paid the invoice goes back to "needs attention" with it.
    yield* orgQuery((db, organizationId) =>
      db.batch([
        db
          .update(invoice)
          .set({ paidOn: null })
          .where(and(eq(invoice.id, inv.id), eq(invoice.organizationId, organizationId))),
        db
          .update(payment)
          .set({ status: 'unmatched', invoiceId: null, marksInvoicePaid: false, note: null })
          .where(
            and(
              eq(payment.invoiceId, inv.id),
              eq(payment.organizationId, organizationId),
              eq(payment.marksInvoicePaid, true),
            ),
          ),
      ]),
    )
    return yield* getInvoice(inv.id)
  })

/** Voids an unpaid invoice that has no credit notes. It keeps its number. */
export const voidInvoice = (invoiceId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const inv = yield* getInvoice(invoiceId)
    if (inv.status === 'void') return yield* new Conflict({ message: 'Avin är redan makulerad' })
    if (inv.status === 'paid') {
      return yield* new Conflict({ message: 'En betald avi kan inte makuleras' })
    }
    if (inv.creditedOre > 0) {
      return yield* new Conflict({
        message: 'En krediterad avi kan inte makuleras. Kreditera resten i stället.',
      })
    }
    yield* updateInvoice(inv.id, { voidedAt: new Date(yield* Clock.currentTimeMillis) })
    return yield* getInvoice(inv.id)
  })

// ---------------------------------------------------------------------------------------------
// Credit notes

const creditProblemMessages: Record<CreditProblem, string> = {
  void: 'En makulerad avi kan inte krediteras',
  nothing_left: 'Avin är redan krediterad i sin helhet',
  not_positive: 'Ange ett belopp större än noll',
  too_much: 'Beloppet är större än det som återstår att kreditera',
}

/**
 * Issues a credit note against an invoice: the next number in the company's credit note series,
 * the invoice's recipient details, and the credited amount added to the invoice, all in one
 * batch. Two credit notes created at once get the same number and the second batch fails on the
 * unique index, so a credit is always computed from the invoice as it is.
 */
export const createCreditNote = (input: CreateCreditNoteInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const inv = yield* getInvoice(input.invoiceId)
    const result = draftCreditNote(
      inv,
      input.kind === 'rest' ? { kind: 'rest' } : { kind: 'amount', netOre: input.netOre ?? 0 },
    )
    if (!result.ok) return yield* new Conflict({ message: creditProblemMessages[result.problem] })
    const { draft } = result

    const issueDate = yield* today
    const [{ maxNumber }] = yield* orgQuery((db, organizationId) =>
      db
        .select({ maxNumber: sql<number>`coalesce(max(${creditNote.number}), 0)` })
        .from(creditNote)
        .where(eq(creditNote.organizationId, organizationId)),
    )
    const id = crypto.randomUUID()
    yield* orgQuery((db, organizationId) =>
      db.batch([
        db.insert(creditNote).values({
          id,
          organizationId,
          number: maxNumber + 1,
          invoiceId: inv.id,
          reason: input.reason.trim(),
          recipientName: inv.recipientName,
          recipientStreetAddress: inv.recipientStreetAddress,
          recipientPostalCode: inv.recipientPostalCode,
          recipientCity: inv.recipientCity,
          recipientEmail: inv.recipientEmail,
          issueDate,
          netOre: draft.netOre,
          vatOre: draft.vatOre,
          totalOre: draft.totalOre,
        }),
        db.insert(creditNoteLine).values(
          draft.lines.map((line, index) => ({
            creditNoteId: id,
            organizationId,
            position: index + 1,
            ...line,
          })),
        ),
        db
          .update(invoice)
          .set({ creditedOre: sql`${invoice.creditedOre} + ${draft.totalOre}` })
          .where(and(eq(invoice.id, inv.id), eq(invoice.organizationId, organizationId))),
      ]),
    )
    return { id }
  })

export const getCreditNote = (creditNoteId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    const row = yield* orgQuery((db, organizationId) =>
      db.query.creditNote.findFirst({
        where: and(eq(creditNote.id, creditNoteId), eq(creditNote.organizationId, organizationId)),
        with: {
          lines: { orderBy: creditNoteLine.position },
          invoice: {
            columns: {
              id: true,
              number: true,
              issueDate: true,
              periodStart: true,
              periodEnd: true,
              paidOn: true,
            },
          },
        },
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'creditNote', id: creditNoteId })
    return { ...row, seller: yield* loadSettings }
  })

export type CreditNoteView = Effect.Success<ReturnType<typeof getCreditNote>>

/** Emails a credit note to the recipient of the invoice it credits and records when. */
export const emailCreditNote = (creditNoteId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const note = yield* getCreditNote(creditNoteId)
    if (!note.recipientEmail) {
      return yield* new Conflict({ message: 'Hyresgästen har ingen e-postadress' })
    }
    const negative = (ore: number) => formatSek(-ore)
    yield* sendEmail({
      to: note.recipientEmail,
      template: 'creditNote',
      props: {
        recipientName: note.recipientName,
        organizationName: note.seller.organizationName,
        creditNoteNumber: note.number,
        invoiceNumber: note.invoice.number,
        invoiceIssueDate: note.invoice.issueDate,
        issueDate: note.issueDate,
        reason: note.reason,
        lines: note.lines.map((l) => ({ description: l.description, amount: negative(l.netOre) })),
        net: negative(note.netOre),
        vat: note.vatOre > 0 ? negative(note.vatOre) : null,
        total: negative(note.totalOre),
        refund: note.invoice.paidOn !== null,
        sellerDetails: sellerDetails(note.seller, note.vatOre > 0),
      },
    })
    const sentAt = new Date(yield* Clock.currentTimeMillis)
    yield* orgQuery((db, organizationId) =>
      db
        .update(creditNote)
        .set({ sentAt })
        .where(and(eq(creditNote.id, note.id), eq(creditNote.organizationId, organizationId))),
    )
    return true
  })
