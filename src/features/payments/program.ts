import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import { invoice, payment, paymentImport } from '#/db/schema'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { CurrentUser } from '#/server/services'
import { Camt054Error, parseCamt054 } from './camt054'
import { type InvoiceForMatching, matchPayments } from './matching'
import type { AssignPaymentInput, ImportPaymentsInput, PaymentFilter } from './schemas'

/** D1 allows 100 bound parameters per statement; `IN (...)` lists stay well below that. */
const IN_CHUNK = 50
/** Statements per D1 batch. Each payment needs at most two (insert + invoice update). */
const BATCH_STATEMENTS = 50

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  )

// ---------------------------------------------------------------------------------------------
// Import

export const importPayments = (input: ImportPaymentsInput) =>
  Effect.gen(function* () {
    const me = yield* CurrentUser
    const parsed = yield* Effect.try({
      try: () => parseCamt054(input.content),
      catch: (e) =>
        new Conflict({
          message:
            e instanceof Camt054Error
              ? `${e.message}. Välj en camt.054-fil från banken.`
              : 'Filen kunde inte läsas. Välj en camt.054-fil från banken.',
        }),
    })

    // Skip payments seen before (in an earlier file, or twice in this one).
    const seen = new Set<string>()
    for (const refs of chunks(
      [...new Set(parsed.payments.map((p) => p.bankReference))],
      IN_CHUNK,
    )) {
      const rows = yield* orgQuery((db, organizationId) =>
        db
          .select({ bankReference: payment.bankReference })
          .from(payment)
          .where(
            and(eq(payment.organizationId, organizationId), inArray(payment.bankReference, refs)),
          ),
      )
      for (const r of rows) seen.add(r.bankReference)
    }
    const fresh = parsed.payments.filter((p) => {
      if (seen.has(p.bankReference)) return false
      seen.add(p.bankReference)
      return true
    })

    const invoicesByOcr = new Map<string, InvoiceForMatching>()
    const ocrs = [
      ...new Set(fresh.map((p) => p.reference?.replace(/\D/g, '') ?? '').filter(Boolean)),
    ]
    for (const batch of chunks(ocrs, IN_CHUNK)) {
      const rows = yield* orgQuery((db, organizationId) =>
        db
          .select({
            id: invoice.id,
            number: invoice.number,
            ocr: invoice.ocr,
            totalOre: invoice.totalOre,
            paidOn: invoice.paidOn,
            voidedAt: invoice.voidedAt,
          })
          .from(invoice)
          .where(and(eq(invoice.organizationId, organizationId), inArray(invoice.ocr, batch))),
      )
      for (const r of rows) invoicesByOcr.set(r.ocr, { ...r, voided: r.voidedAt !== null })
    }
    const results = matchPayments(fresh, invoicesByOcr)

    const importId = crypto.randomUUID()
    yield* orgQuery((db, organizationId) =>
      db.insert(paymentImport).values({
        id: importId,
        organizationId,
        fileName: input.fileName,
        messageId: parsed.messageId,
        importedByUserId: me.id,
        paymentCount: fresh.length,
        duplicateCount: parsed.payments.length - fresh.length,
        totalOre: fresh.reduce((sum, p) => sum + p.amountOre, 0),
      }),
    )

    // A payment and the invoice update it causes always land in the same batch, so a failure
    // part-way leaves no half-booked payment; importing the file again picks up the rest.
    const rows = fresh.map((p, i) => ({ p, match: results[i] }))
    for (const group of chunks(rows, BATCH_STATEMENTS / 2)) {
      yield* orgQuery((db, organizationId) => {
        const statements = group.flatMap(({ p, match }) => [
          db.insert(payment).values({
            organizationId,
            importId,
            bankReference: p.bankReference,
            bookingDate: p.bookingDate,
            amountOre: p.amountOre,
            reference: p.reference,
            payerName: p.payerName,
            status: match.status,
            note: match.note,
            invoiceId: match.invoiceId,
            marksInvoicePaid: match.marksInvoicePaid,
          }),
          ...(match.marksInvoicePaid && match.invoiceId
            ? [
                db
                  .update(invoice)
                  .set({ paidOn: p.bookingDate })
                  .where(
                    and(
                      eq(invoice.id, match.invoiceId),
                      eq(invoice.organizationId, organizationId),
                      isNull(invoice.paidOn),
                      isNull(invoice.voidedAt),
                    ),
                  ),
              ]
            : []),
        ])
        const [first, ...rest] = statements
        return db.batch([first, ...rest])
      })
    }

    const count = (status: string) => results.filter((r) => r.status === status).length
    return {
      importId,
      imported: fresh.length,
      matched: count('matched'),
      review: count('review'),
      unmatched: count('unmatched'),
      duplicates: parsed.payments.length - fresh.length,
      skippedDebits: parsed.skippedDebits,
      skippedOtherCurrency: parsed.skippedOtherCurrency,
    }
  })

// ---------------------------------------------------------------------------------------------
// Reading

const statusesFor: Record<PaymentFilter, readonly (typeof payment.$inferSelect)['status'][]> = {
  attention: ['review', 'unmatched'],
  matched: ['matched'],
  ignored: ['ignored'],
  all: ['matched', 'review', 'unmatched', 'ignored'],
}

export const listPayments = (filter: PaymentFilter) =>
  orgQuery((db, organizationId) =>
    db.query.payment.findMany({
      where: and(
        eq(payment.organizationId, organizationId),
        inArray(payment.status, [...statusesFor[filter]]),
      ),
      orderBy: [desc(payment.bookingDate), desc(payment.createdAt)],
      with: {
        invoice: { columns: { id: true, number: true, recipientName: true, totalOre: true } },
      },
    }),
  )

export const listPaymentImports = orgQuery((db, organizationId) =>
  db.query.paymentImport.findMany({
    where: eq(paymentImport.organizationId, organizationId),
    orderBy: desc(paymentImport.createdAt),
    limit: 20,
  }),
)

/** Invoices a payment can be linked to by hand. */
export const listOpenInvoices = orgQuery((db, organizationId) =>
  db
    .select({
      id: invoice.id,
      number: invoice.number,
      ocr: invoice.ocr,
      recipientName: invoice.recipientName,
      totalOre: invoice.totalOre,
      dueDate: invoice.dueDate,
    })
    .from(invoice)
    .where(
      and(
        eq(invoice.organizationId, organizationId),
        isNull(invoice.paidOn),
        isNull(invoice.voidedAt),
      ),
    )
    .orderBy(desc(invoice.number)),
)

// ---------------------------------------------------------------------------------------------
// Manual handling

const getPayment = (paymentId: string) =>
  Effect.gen(function* () {
    const row = yield* orgQuery((db, organizationId) =>
      db.query.payment.findFirst({
        where: and(eq(payment.id, paymentId), eq(payment.organizationId, organizationId)),
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'payment', id: paymentId })
    return row
  })

const setPayment = (paymentId: string, values: Partial<typeof payment.$inferInsert>) =>
  orgQuery((db, organizationId) =>
    db
      .update(payment)
      .set(values)
      .where(and(eq(payment.id, paymentId), eq(payment.organizationId, organizationId))),
  )

/** Books a payment that needs attention against an open invoice, which becomes paid. */
export const assignPayment = (input: AssignPaymentInput) =>
  Effect.gen(function* () {
    const p = yield* getPayment(input.paymentId)
    if (p.status === 'matched') {
      return yield* new Conflict({ message: 'Betalningen är redan kopplad till en avi' })
    }
    const inv = yield* orgQuery((db, organizationId) =>
      db.query.invoice.findFirst({
        where: and(eq(invoice.id, input.invoiceId), eq(invoice.organizationId, organizationId)),
      }),
    )
    if (!inv) return yield* new NotFound({ entity: 'invoice', id: input.invoiceId })
    if (inv.voidedAt) return yield* new Conflict({ message: `Avi ${inv.number} är makulerad` })
    if (inv.paidOn) return yield* new Conflict({ message: `Avi ${inv.number} är redan betald` })

    yield* orgQuery((db, organizationId) =>
      db.batch([
        db
          .update(payment)
          .set({
            status: 'matched',
            invoiceId: inv.id,
            marksInvoicePaid: true,
            note:
              p.amountOre === inv.totalOre
                ? 'Kopplad manuellt'
                : `Kopplad manuellt (${p.note ?? 'avvikande belopp'})`,
          })
          .where(and(eq(payment.id, p.id), eq(payment.organizationId, organizationId))),
        db
          .update(invoice)
          .set({ paidOn: p.bookingDate })
          .where(
            and(
              eq(invoice.id, inv.id),
              eq(invoice.organizationId, organizationId),
              isNull(invoice.paidOn),
            ),
          ),
      ]),
    )
  })

/** For payments that are not rent, e.g. a deposit or a refund handled elsewhere. */
export const ignorePayment = (paymentId: string) =>
  Effect.gen(function* () {
    const p = yield* getPayment(paymentId)
    if (p.status === 'matched') {
      return yield* new Conflict({ message: 'Ångra kopplingen innan du ignorerar betalningen' })
    }
    yield* setPayment(p.id, { status: 'ignored' })
  })

/** Puts a matched or ignored payment back for handling; reopens the invoice it had paid. */
export const undoPayment = (paymentId: string) =>
  Effect.gen(function* () {
    const p = yield* getPayment(paymentId)
    if (p.status !== 'matched' && p.status !== 'ignored') {
      return yield* new Conflict({ message: 'Betalningen är inte hanterad' })
    }
    yield* orgQuery((db, organizationId) => {
      const reset = db
        .update(payment)
        .set({ status: 'unmatched', invoiceId: null, marksInvoicePaid: false, note: null })
        .where(and(eq(payment.id, p.id), eq(payment.organizationId, organizationId)))
      if (!(p.marksInvoicePaid && p.invoiceId)) return reset.then(() => undefined)
      return db.batch([
        reset,
        db
          .update(invoice)
          .set({ paidOn: null })
          .where(and(eq(invoice.id, p.invoiceId), eq(invoice.organizationId, organizationId))),
      ])
    })
  })
