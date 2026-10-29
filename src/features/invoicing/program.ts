import { desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import {
  agreement,
  type agreementParty,
  type agreementUnit,
  type charge,
  creditNote,
  creditNoteLine,
  invoice,
  invoiceLine,
  type party,
  payment,
  paymentReminder,
} from '#/db/schema'
import { billFor } from '#/features/agreements/billing'
import { billedOnceChargeIds, billingAvier } from '#/features/agreements/program'
import {
  creditNoteEntries,
  creditTransferEntries,
  creditUseEntries,
  type InvoiceMoney,
  invoiceEntries,
  manualPaymentEntries,
  statusFromMoney,
} from '#/features/ledger/postings'
import {
  allInvoiceMoney,
  creditBalances,
  invoiceMoneyFor,
  livePostings,
  postingStatements,
  reversalStatements,
} from '#/features/ledger/program'
import { settlementStatements } from '#/features/ledger/settlement'
import { undoPaymentStatements } from '#/features/payments/program'
import { loadCompanyDetails } from '#/features/settings/program'
import { sellerDetails } from '#/features/settings/seller'
import { documentTerms } from '#/features/settings/terminology'
import { stockholmDate } from '#/lib/dates'
import { formatSek } from '#/lib/money'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { forEachBestEffort } from '#/server/best-effort'
import { Conflict, NotFound } from '#/server/errors'
import { sendEmail } from '#/server/mail/mailer'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { today } from '#/server/today'
import { type ReissueProblem, reissueProblem, type VoidProblem, voidProblem } from './correction'
import { type CreditProblem, draftCreditNote } from './credit'
import { matchesFilter } from './overview'
import { dueDate, invoicePeriod, ocrFor, type Period, periodLabel } from './rules'
import type {
  CreateCreditNoteInput,
  CreateInvoiceRunInput,
  ListInvoicesInput,
  MarkPaidInput,
} from './schemas'

/**
 * The statements that use the party's credit balance (tillgodo) on a new avi, in the batch that
 * issues it: as much as the avi's total allows. `credit` tracks what is left per party during a
 * run, so two avier to the same party don't use the same credit twice.
 */
function creditUseStatements(
  db: Parameters<Parameters<typeof orgQuery>[0]>[0],
  organizationId: string,
  credit: Map<string, number>,
  avi: { id: string; number: number; totalOre: number; issueDate: string },
  owner: { partyId: string; agreementId: string },
) {
  const available = credit.get(owner.partyId) ?? 0
  const amountOre = Math.min(available, avi.totalOre)
  if (amountOre <= 0) return []
  credit.set(owner.partyId, available - amountOre)
  return postingStatements(
    db,
    organizationId,
    {
      date: avi.issueDate,
      kind: 'credit_use',
      description: `Tillgodo avräknat på avi ${avi.number}`,
      invoiceId: avi.id,
    },
    creditUseEntries(avi.id, amountOre),
    owner,
  )
}

const read: Permissions = { invoice: ['read'] }
const manage: Permissions = { invoice: ['manage'] }
/**
 * A run reads every agreement (leases and bostadsrätter alike); seeing agreements is the lease
 * permission, so it also needs that.
 */
const runInvoices: Permissions = { invoice: ['manage'], lease: ['read'] }
/** Paying money back is booked like a payment. */

// ---------------------------------------------------------------------------------------------
// Invoice runs

/**
 * What billing reads from an agreement: its charges (the lines), parties (the recipient) and
 * units (the line text), each with the dates they apply.
 */
const billingDetails = {
  charges: true,
  parties: { with: { party: true } },
  units: { with: { unit: { with: { property: { columns: { designation: true } } } } } },
} as const

type BillingRow = typeof agreement.$inferSelect & {
  charges: (typeof charge.$inferSelect)[]
  parties: (typeof agreementParty.$inferSelect & { party: typeof party.$inferSelect })[]
  units: (typeof agreementUnit.$inferSelect & {
    unit: { label: string; property: { designation: string } }
  })[]
}

/** The avi an agreement gets for a period (see `billFor`), or null when nothing is billed. */
const billRow = (a: BillingRow, period: Period, billedOnce: ReadonlySet<string>) =>
  billFor(
    {
      ...a,
      units: a.units.map(({ unit, ...u }) => ({
        ...u,
        designation: unit.property.designation,
        label: unit.label,
      })),
    },
    period,
    billedOnce,
  )

/** What a run for `month` would invoice. Agreements already invoiced for the period are flagged. */
export const previewInvoiceRun = Effect.fn('invoicing.previewInvoiceRun')(function* (
  month: string,
) {
  yield* requirePermission(runInvoices)
  const issueDate = yield* today
  const settings = yield* loadCompanyDetails

  const agreements: BillingRow[] = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findMany({
      where: inCompany(agreement, organizationId),
      orderBy: agreement.number,
      with: billingDetails,
    }),
  )
  // Every period in a run starts on the first of the month, whatever the invoice interval.
  // Any avi for the period counts, voided and credited ones too: a run never re-issues a period
  // someone corrected. A corrected avi is issued from the avi it replaces instead.
  const periodStart = `${month}-01`
  const invoiced = yield* orgQuery((db, organizationId) =>
    db
      .select({ agreementId: invoice.agreementId })
      .from(invoice)
      .where(inCompany(invoice, organizationId, eq(invoice.periodStart, periodStart))),
  )
  const alreadyInvoiced = new Set(invoiced.map((i) => i.agreementId))
  const billedOnce = yield* billedOnceChargeIds(agreements.map((a) => a.id))

  const rows = agreements.flatMap((a) => {
    const period = invoicePeriod(month, a.invoiceInterval)
    if (!period) return []
    const bill = billRow(a, period, billedOnce)
    if (!bill) return []
    return [
      {
        agreementId: a.id,
        agreementNumber: a.number,
        recipient: bill.recipient,
        period,
        lines: bill.lines,
        /** The first line, to name the avi in previews. */
        description: bill.lines[0].description,
        netOre: bill.netOre,
        vatOre: bill.vatOre,
        totalOre: bill.totalOre,
        dueDate: dueDate(period, issueDate),
        alreadyInvoiced: alreadyInvoiced.has(a.id),
      },
    ]
  })

  return { month, issueDate, canInvoice: settings.bankgiro !== null, rows }
})

export type InvoiceRunPreview = Effect.Success<ReturnType<typeof previewInvoiceRun>>

/**
 * D1 caps statements per batch; each avi needs four (avi, lines, posting, entries). Each chunk is
 * atomic on its own.
 */
const CHUNK_SIZE = 12

export const createInvoiceRun = Effect.fn('invoicing.createInvoiceRun')(function* (
  input: CreateInvoiceRunInput,
) {
  yield* requirePermission(runInvoices)
  const preview = yield* previewInvoiceRun(input.month)
  if (!preview.canInvoice) {
    return yield* new Conflict({
      message: 'Ange bankgironummer under Företagsuppgifter innan du skapar avier.',
    })
  }
  const pending = preview.rows.filter((r) => !r.alreadyInvoiced)
  const credit = yield* creditBalances(pending.map((r) => r.recipient.partyId))

  const [{ maxNumber }] = yield* orgQuery((db, organizationId) =>
    db
      .select({ maxNumber: sql<number>`coalesce(max(${invoice.number}), 0)` })
      .from(invoice)
      .where(inCompany(invoice, organizationId)),
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
          agreementId: row.agreementId,
          ...row.recipient,
          periodStart: row.period.start,
          periodEnd: row.period.end,
          issueDate: preview.issueDate,
          dueDate: row.dueDate,
          netOre: row.netOre,
          vatOre: row.vatOre,
          totalOre: row.totalOre,
        }),
        db.insert(invoiceLine).values(
          row.lines.map((line, index) => ({
            ...line,
            invoiceId: id,
            organizationId,
            position: index + 1,
          })),
        ),
        ...postingStatements(
          db,
          organizationId,
          {
            date: preview.issueDate,
            kind: 'invoice',
            description: `Avi ${number}`,
            invoiceId: id,
          },
          invoiceEntries({ id, ...row }),
          { partyId: row.recipient.partyId, agreementId: row.agreementId },
        ),
        ...creditUseStatements(
          db,
          organizationId,
          credit,
          { id, number, totalOre: row.totalOre, issueDate: preview.issueDate },
          { partyId: row.recipient.partyId, agreementId: row.agreementId },
        ),
      ])
      const [first, ...rest] = statements
      return db.batch([first, ...rest])
    })
    createdIds.push(...chunk.map((c) => c.id))
  }

  const withEmail = pending.filter((r) => r.recipient.recipientEmail).length
  const emails =
    input.send && createdIds.length > 0
      ? yield* forEachBestEffort(createdIds, (id) => emailInvoice(id, { skipWithoutEmail: true }), {
          label: 'Could not email avi',
          concurrency: 4,
        })
      : { succeeded: [], failed: [] }
  // emailInvoice gives false for an avi without an email address.
  const sent = emails.succeeded.filter((e) => e.value).length
  const failedInvoiceIds = emails.failed

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

/** An avi with its money from the ledger: owed, paid, credited, to pay back, and its status. */
const toView = <R extends typeof invoice.$inferSelect>(
  row: R,
  money: InvoiceMoney,
  on: string,
) => ({
  ...row,
  ...money,
  status: statusFromMoney(row, money, on),
})

export const listInvoices = Effect.fn('invoicing.listInvoices')(function* (
  input: ListInvoicesInput,
) {
  yield* requirePermission(read)
  // The lease's current units label each row; only for those who may read leases and units.
  const showUnits = yield* hasPermission({ lease: ['read'], property: ['read'] })
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.invoice.findMany({
      where: inCompany(
        invoice,
        organizationId,
        input.agreementId ? eq(invoice.agreementId, input.agreementId) : undefined,
      ),
      orderBy: desc(invoice.number),
      with: {
        reminders: { columns: { sentOn: true } },
        agreement: {
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
  const moneyOf = yield* allInvoiceMoney
  const views = rows.map(({ agreement: billed, reminders, ...row }) => ({
    ...toView(row, moneyOf(row.id), on),
    /** The latest reminder sent for the avi, if any. */
    lastRemindedOn:
      reminders
        .map((r) => r.sentOn)
        .sort()
        .at(-1) ?? null,
    units: showUnits
      ? billed.units.map(({ unit }) => ({
          kind: unit.kind,
          label: unit.label,
          designation: unit.property.designation,
        }))
      : [],
  }))
  return views.filter((v) => matchesFilter(v.status, input.filter))
})

export const getInvoice = Effect.fn('invoicing.getInvoice')(function* (invoiceId: string) {
  yield* requirePermission(read)
  const row = yield* orgQuery((db, organizationId) =>
    db.query.invoice.findFirst({
      where: inCompany(invoice, organizationId, eq(invoice.id, invoiceId)),
      with: {
        lines: { orderBy: invoiceLine.position },
        agreement: { columns: { id: true, number: true, kind: true, endDate: true } },
        creditNotes: {
          columns: {
            id: true,
            number: true,
            issueDate: true,
            totalOre: true,
            reason: true,
          },
          orderBy: creditNote.number,
        },
        reminders: { orderBy: paymentReminder.sequence },
        lateInterest: {
          columns: { chargeId: true, fromDate: true, toDate: true, days: true, amountOre: true },
        },
        replaces: { columns: { id: true, number: true } },
        replacedBy: {
          columns: { id: true, number: true, issueDate: true },
          orderBy: invoice.number,
        },
      },
    }),
  ).pipe(orNotFound('invoice', invoiceId))
  const seller = yield* loadCompanyDetails
  const money = (yield* invoiceMoneyFor([row.id]))(row.id)
  // Payments on the avi, from the ledger: bank payments matched to it and payments registered
  // by hand. Listed only for those who may read payments.
  const payments = (yield* hasPermission({ payment: ['read'] }))
    ? yield* invoicePayments(row.id)
    : []
  // Late interest and reminder fees are billed by a later avi of the agreement; which one,
  // once it has.
  const interest = row.lateInterest
  const billed = yield* billingAvier([
    interest?.chargeId ?? null,
    ...row.reminders.map((r) => r.feeChargeId),
  ])
  const billedBy = (chargeId: string | null) => {
    const avi = chargeId ? billed.get(chargeId) : undefined
    return avi && !avi.voided ? { id: avi.id, number: avi.number } : null
  }
  return {
    ...toView(row, money, yield* today),
    reminders: row.reminders.map((r) => ({ ...r, feeBilledBy: billedBy(r.feeChargeId) })),
    lateInterest: interest ? { ...interest, billedBy: billedBy(interest.chargeId) } : null,
    payments,
    seller,
  }
})

export type InvoiceView = Effect.Success<ReturnType<typeof getInvoice>>

/** The live payments on an avi: matched bank payments (with the bank's details) and by hand. */
const invoicePayments = (invoiceId: string) =>
  Effect.gen(function* () {
    const live = yield* livePostings({ kinds: ['allocation', 'manual_payment'], invoiceId })
    const paymentIds = live.flatMap((l) => (l.posting.paymentId ? [l.posting.paymentId] : []))
    const bank =
      paymentIds.length === 0
        ? []
        : yield* orgQuery((db, organizationId) =>
            db
              .select({
                id: payment.id,
                payerName: payment.payerName,
                status: payment.status,
              })
              .from(payment)
              .where(inCompany(payment, organizationId, inArray(payment.id, paymentIds))),
          )
    return live
      .map(({ posting: p, entries }) => {
        const receivable = entries.find((e) => e.account === 'receivable')
        const fromBank = bank.find((b) => b.id === p.paymentId) ?? null
        return {
          id: p.id,
          date: p.date,
          /** What this payment settled on the avi (a bank payment may be split). */
          amountOre: -(receivable?.amountOre ?? 0),
          paymentId: p.paymentId,
          payerName: fromBank?.payerName ?? null,
          status: fromBank?.status ?? null,
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  })

// ---------------------------------------------------------------------------------------------
// Sending and payments

/**
 * Emails one invoice to its recipient and records when it was sent. Returns false when the
 * tenant has no email address and `skipWithoutEmail` is set.
 */
export const emailInvoice = Effect.fn('invoicing.emailInvoice')(function* (
  invoiceId: string,
  options: { skipWithoutEmail?: boolean } = {},
) {
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
    return yield* new Conflict({ message: 'Ange bankgironummer under Företagsuppgifter först' })
  }

  yield* sendEmail({
    to: inv.recipientEmail,
    template: 'rentInvoice',
    props: {
      documentName: documentTerms(inv.agreement.kind).invoiceTitle,
      recipientName: inv.recipientName,
      organizationName: inv.seller.organizationName,
      invoiceNumber: inv.number,
      periodLabel: periodLabel({ start: inv.periodStart, end: inv.periodEnd }),
      lines: inv.lines.map((l) => ({ description: l.description, amount: formatSek(l.netOre) })),
      net: formatSek(inv.netOre),
      vat: inv.vatOre > 0 ? formatSek(inv.vatOre) : null,
      total: formatSek(inv.totalOre),
      creditUsed: inv.creditUsedOre > 0 ? formatSek(-inv.creditUsedOre) : null,
      toPay: formatSek(inv.totalOre - inv.creditUsedOre),
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
      .where(inCompany(invoice, organizationId, eq(invoice.id, inv.id))),
  )
  return true
})

export const markInvoicePaid = Effect.fn('invoicing.markInvoicePaid')(function* (
  input: MarkPaidInput,
) {
  yield* requirePermission(manage)
  const inv = yield* getInvoice(input.invoiceId)
  if (inv.status === 'void') return yield* new Conflict({ message: 'Avin är makulerad' })
  if (inv.status === 'paid') return yield* new Conflict({ message: 'Avin är redan betald' })
  if (inv.status === 'credited') return yield* new Conflict({ message: 'Avin är krediterad' })
  if (input.paidOn > (yield* today)) {
    return yield* new Conflict({ message: 'Betaldatum kan inte vara i framtiden' })
  }
  // A payment by hand settles what is still owed, straight from the bank, with what settling
  // the avi brings along (fee waivers, late interest).
  const settled = (yield* settlementStatements(
    new Map([[inv.id, [{ kind: 'manual_payment', date: input.paidOn, amountOre: -inv.owedOre }]]]),
  )).get(inv.id)
  yield* orgQuery((db, organizationId) =>
    db.batch([
      ...postingStatements(
        db,
        organizationId,
        {
          date: input.paidOn,
          kind: 'manual_payment',
          description: `Betalning av avi ${inv.number}`,
          invoiceId: inv.id,
        },
        manualPaymentEntries(inv.id, inv.owedOre),
        { partyId: inv.partyId, agreementId: inv.agreementId },
      ),
      ...(settled ? settled(db, organizationId) : []),
    ]),
  )
  return yield* getInvoice(inv.id)
})

/**
 * "Ångra betalning": reverses every payment on the avi. A bank payment is undone as a whole, on
 * every avi it was split over, and goes back to needing attention; payments by hand are
 * reversed. Credit used on the avi stays.
 */
export const unmarkInvoicePaid = Effect.fn('invoicing.unmarkInvoicePaid')(function* (
  invoiceId: string,
) {
  yield* requirePermission({ invoice: ['manage'], payment: ['manage'] })
  const inv = yield* getInvoice(invoiceId)
  if (inv.paidOre <= 0) return yield* new Conflict({ message: 'Avin har inga betalningar' })
  const live = yield* livePostings({ kinds: ['allocation', 'manual_payment'], invoiceId: inv.id })
  const byHand = live.filter((l) => l.posting.kind === 'manual_payment')
  const paymentIds = [
    ...new Set(live.flatMap((l) => (l.posting.paymentId ? [l.posting.paymentId] : []))),
  ]
  const on = yield* today
  const bank = paymentIds.length > 0 ? yield* undoPaymentStatements(paymentIds, on) : null
  yield* orgQuery((db, organizationId) => {
    const [first, ...rest] = [
      ...reversalStatements(
        db,
        organizationId,
        byHand,
        on,
        () => `Ångrad betalning av avi ${inv.number}`,
      ),
      ...(bank ? bank(db, organizationId) : []),
    ]
    return db.batch([first, ...rest])
  })
  return yield* getInvoice(inv.id)
})

const voidProblemMessages: Record<VoidProblem, string> = {
  void: 'Avin är redan makulerad',
  paid: 'En betald avi kan inte makuleras',
  credited: 'En krediterad avi kan inte makuleras. Kreditera resten i stället.',
  sent: 'En skickad avi kan inte makuleras. Kreditera den i stället.',
}

/** Voids an unsent, unpaid invoice that has no credit notes. It keeps its number. */
export const voidInvoice = Effect.fn('invoicing.voidInvoice')(function* (invoiceId: string) {
  yield* requirePermission(manage)
  const inv = yield* getInvoice(invoiceId)
  const problem = voidProblem(inv)
  if (problem) return yield* new Conflict({ message: voidProblemMessages[problem] })
  const voidedAt = new Date(yield* Clock.currentTimeMillis)
  const issued = yield* livePostings({ kinds: ['invoice'], invoiceId: inv.id })
  const creditUsed = yield* livePostings({ kinds: ['credit_use'], invoiceId: inv.id })
  // Voiding reverses the avi's posting, so nothing is owed or booked as income, and gives back
  // any credit used on it.
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db
        .update(invoice)
        .set({ voidedAt })
        .where(inCompany(invoice, organizationId, eq(invoice.id, inv.id))),
      ...reversalStatements(
        db,
        organizationId,
        issued,
        stockholmDate(voidedAt.getTime()),
        () => `Makulering av avi ${inv.number}`,
        'void',
      ),
      ...reversalStatements(
        db,
        organizationId,
        creditUsed,
        stockholmDate(voidedAt.getTime()),
        () => `Tillgodo åter vid makulering av avi ${inv.number}`,
      ),
    ]),
  )
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
export const createCreditNote = Effect.fn('invoicing.createCreditNote')(function* (
  input: CreateCreditNoteInput,
) {
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
      .where(inCompany(creditNote, organizationId)),
  )
  const id = crypto.randomUUID()
  // A credit beyond what is still owed (the avi was paid, or paid with credit) becomes the
  // party's credit balance, to be used on the next avi or paid back.
  const toCreditOre = Math.max(0, draft.totalOre - Math.max(0, inv.owedOre))
  const owner = { partyId: inv.partyId, agreementId: inv.agreementId }
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
        .where(inCompany(invoice, organizationId, eq(invoice.id, inv.id))),
      ...postingStatements(
        db,
        organizationId,
        {
          date: issueDate,
          kind: 'credit_note',
          description: `Kreditfaktura ${maxNumber + 1}`,
          invoiceId: inv.id,
          creditNoteId: id,
        },
        creditNoteEntries(inv.id, draft),
        owner,
      ),
      ...(toCreditOre > 0
        ? postingStatements(
            db,
            organizationId,
            {
              date: issueDate,
              kind: 'credit_transfer',
              description: `Kreditfaktura ${maxNumber + 1} till tillgodo`,
              invoiceId: inv.id,
              creditNoteId: id,
            },
            creditTransferEntries(inv.id, toCreditOre),
            owner,
          )
        : []),
    ]),
  )
  return { id }
})

export const getCreditNote = Effect.fn('invoicing.getCreditNote')(function* (creditNoteId: string) {
  yield* requirePermission(read)
  const row = yield* orgQuery((db, organizationId) =>
    db.query.creditNote.findFirst({
      where: inCompany(creditNote, organizationId, eq(creditNote.id, creditNoteId)),
      with: {
        lines: { orderBy: creditNoteLine.position },
        invoice: {
          columns: {
            id: true,
            number: true,
            issueDate: true,
            periodStart: true,
            periodEnd: true,
          },
          with: { agreement: { columns: { kind: true } } },
        },
      },
    }),
  ).pipe(orNotFound('creditNote', creditNoteId))
  const money = (yield* invoiceMoneyFor([row.invoice.id]))(row.invoice.id)
  return {
    ...row,
    /** Whether the credit went (in part) to the party's credit balance: the avi had been paid. */
    toCredit: money.toCreditOre > 0,
    invoiceMoney: money,
    seller: yield* loadCompanyDetails,
  }
})

export type CreditNoteView = Effect.Success<ReturnType<typeof getCreditNote>>

/** Emails a credit note to the recipient of the invoice it credits and records when. */
export const emailCreditNote = Effect.fn('invoicing.emailCreditNote')(function* (
  creditNoteId: string,
) {
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
      invoiceName: documentTerms(note.invoice.agreement.kind).invoiceTitle,
      invoiceNumber: note.invoice.number,
      invoiceIssueDate: note.invoice.issueDate,
      issueDate: note.issueDate,
      reason: note.reason,
      lines: note.lines.map((l) => ({ description: l.description, amount: negative(l.netOre) })),
      net: negative(note.netOre),
      vat: note.vatOre > 0 ? negative(note.vatOre) : null,
      total: negative(note.totalOre),
      toCredit: note.toCredit,
      sellerDetails: sellerDetails(note.seller, note.vatOre > 0),
    },
  })
  const sentAt = new Date(yield* Clock.currentTimeMillis)
  yield* orgQuery((db, organizationId) =>
    db
      .update(creditNote)
      .set({ sentAt })
      .where(inCompany(creditNote, organizationId, eq(creditNote.id, note.id))),
  )
  return true
})

// ---------------------------------------------------------------------------------------------
// Corrected avier

/** Reissuing reads the lease's current terms, so it also needs to be allowed to read leases. */
const reissue: Permissions = { invoice: ['manage'], lease: ['read'] }

const reissueProblemMessages: Record<ReissueProblem, string> = {
  in_force: 'Avin gäller fortfarande. Makulera eller kreditera den först.',
  already_replaced: 'Det finns redan en avi för perioden',
  no_rent: 'Avtalet har ingen hyra för perioden',
}

/**
 * The corrected avi for a voided or fully credited avi's period: the lease's rent for the period
 * as the lease is now, to the tenant's current details, due by the usual rule from today.
 */
export const previewReissue = Effect.fn('invoicing.previewReissue')(function* (invoiceId: string) {
  yield* requirePermission(reissue)
  const inv = yield* getInvoice(invoiceId)
  const issueDate = yield* today
  const settings = yield* loadCompanyDetails
  const billed: BillingRow | undefined = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findFirst({
      where: inCompany(agreement, organizationId, eq(agreement.id, inv.agreementId)),
      with: billingDetails,
    }),
  )
  if (!billed) return yield* new NotFound({ entity: 'agreement', id: inv.agreementId })
  const others = yield* orgQuery((db, organizationId) =>
    db
      .select({
        voidedAt: invoice.voidedAt,
        totalOre: invoice.totalOre,
        creditedOre: invoice.creditedOre,
      })
      .from(invoice)
      .where(
        inCompany(
          invoice,
          organizationId,
          eq(invoice.agreementId, inv.agreementId),
          eq(invoice.periodStart, inv.periodStart),
          ne(invoice.id, inv.id),
        ),
      ),
  )
  const period = { start: inv.periodStart, end: inv.periodEnd }
  // One-off charges on the avi being replaced are billed again on the corrected one.
  const bill = billRow(billed, period, yield* billedOnceChargeIds([billed.id]))
  const problem = reissueProblem(inv, others, bill?.netOre ?? 0)
  return {
    invoiceId: inv.id,
    agreementId: billed.id,
    recipient: bill?.recipient ?? null,
    period,
    lines: bill?.lines ?? [],
    description: bill?.lines[0]?.description ?? '',
    netOre: bill?.netOre ?? 0,
    vatOre: bill?.vatOre ?? 0,
    totalOre: bill?.totalOre ?? 0,
    issueDate,
    dueDate: dueDate(period, issueDate),
    canInvoice: settings.bankgiro !== null,
    problem: problem && reissueProblemMessages[problem],
  }
})

export type ReissuePreview = Effect.Success<ReturnType<typeof previewReissue>>

/**
 * Issues the corrected avi: the next number, linked to the avi it replaces. The unique index on
 * agreement and period stops a second one if two are issued at once.
 */
export const reissueInvoice = Effect.fn('invoicing.reissueInvoice')(function* (invoiceId: string) {
  yield* requirePermission(reissue)
  const preview = yield* previewReissue(invoiceId)
  if (preview.problem) return yield* new Conflict({ message: preview.problem })
  if (!preview.canInvoice) {
    return yield* new Conflict({
      message: 'Ange bankgironummer under Företagsuppgifter innan du skapar avier.',
    })
  }
  const [{ maxNumber }] = yield* orgQuery((db, organizationId) =>
    db
      .select({ maxNumber: sql<number>`coalesce(max(${invoice.number}), 0)` })
      .from(invoice)
      .where(inCompany(invoice, organizationId)),
  )
  const { recipient } = preview
  if (!recipient) return yield* new Conflict({ message: 'Avtalet har ingen hyra för perioden' })
  const number = maxNumber + 1
  const id = crypto.randomUUID()
  const credit = yield* creditBalances([recipient.partyId])
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db.insert(invoice).values({
        id,
        organizationId,
        number,
        ocr: ocrFor(number),
        agreementId: preview.agreementId,
        ...recipient,
        periodStart: preview.period.start,
        periodEnd: preview.period.end,
        issueDate: preview.issueDate,
        dueDate: preview.dueDate,
        netOre: preview.netOre,
        vatOre: preview.vatOre,
        totalOre: preview.totalOre,
        replacesInvoiceId: preview.invoiceId,
      }),
      db.insert(invoiceLine).values(
        preview.lines.map((line, index) => ({
          ...line,
          invoiceId: id,
          organizationId,
          position: index + 1,
        })),
      ),
      ...postingStatements(
        db,
        organizationId,
        { date: preview.issueDate, kind: 'invoice', description: `Avi ${number}`, invoiceId: id },
        invoiceEntries({ id, ...preview }),
        { partyId: recipient.partyId, agreementId: preview.agreementId },
      ),
      ...creditUseStatements(
        db,
        organizationId,
        credit,
        { id, number, totalOre: preview.totalOre, issueDate: preview.issueDate },
        { partyId: recipient.partyId, agreementId: preview.agreementId },
      ),
    ]),
  )
  return { id }
})
