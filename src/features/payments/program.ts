import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import { invoice, payment, paymentImport } from '#/db/schema'
import {
  allocationEntries,
  type InvoiceMoney,
  paymentEntries,
  statusFromMoney,
} from '#/features/ledger/postings'
import {
  allInvoiceMoney,
  invoiceMoneyFor,
  livePostings,
  paymentAllocations,
  postingStatements,
  reversalStatements,
} from '#/features/ledger/program'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { CurrentUser } from '#/server/services'
import { today } from '#/server/today'
import { Camt054Error, parseCamt054 } from './camt054'
import { type InvoiceForMatching, matchPayments } from './matching'
import type { AssignPaymentInput, ImportPaymentsInput, PaymentFilter } from './schemas'

/** D1 allows 100 bound parameters per statement; `IN (...)` lists stay well below that. */
const IN_CHUNK = 50
/**
 * Statements per D1 batch. Each payment needs at most five: the payment, its posting and
 * entries, and when matched the allocation posting and entries.
 */
const BATCH_STATEMENTS = 50
const PER_PAYMENT = 5

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  )

const read: Permissions = { payment: ['read'] }
const manage: Permissions = { payment: ['manage'] }
/** Booking a payment changes whether an invoice is paid, so it needs both. */
const book: Permissions = { payment: ['manage'], invoice: ['manage'] }

// ---------------------------------------------------------------------------------------------
// Import

export const importPayments = (input: ImportPaymentsInput) =>
  Effect.gen(function* () {
    yield* requirePermission(book)
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

    const invoicesByOcr = yield* invoicesForOcrs(fresh.map((p) => p.reference))
    const results = matchPayments(fresh, invoicesByOcr)
    const owners = new Map([...invoicesByOcr.values()].map((i) => [i.id, i]))

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

    // A payment, its posting and any match always land in the same batch, so a failure part-way
    // leaves no half-booked payment; importing the file again picks up the rest.
    const rows = fresh.map((p, i) => ({ p, match: results[i], id: crypto.randomUUID() }))
    for (const group of chunks(rows, BATCH_STATEMENTS / PER_PAYMENT)) {
      yield* orgQuery((db, organizationId) => {
        const statements = group.flatMap(({ p, match, id }) => {
          const matched = match.allocates && match.invoiceId ? owners.get(match.invoiceId) : null
          return [
            db.insert(payment).values({
              id,
              organizationId,
              importId,
              bankReference: p.bankReference,
              bookingDate: p.bookingDate,
              amountOre: p.amountOre,
              reference: p.reference,
              payerName: p.payerName,
              status: match.status,
              note: match.note,
            }),
            ...postingStatements(
              db,
              organizationId,
              { date: p.bookingDate, kind: 'payment', description: 'Inbetalning', paymentId: id },
              paymentEntries(id, p.amountOre),
            ),
            ...(matched
              ? postingStatements(
                  db,
                  organizationId,
                  {
                    date: p.bookingDate,
                    kind: 'allocation',
                    description: `Betalning av avi ${matched.number}`,
                    invoiceId: matched.id,
                    paymentId: id,
                  },
                  allocationEntries(id, matched.id, p.amountOre),
                  matched,
                )
              : []),
          ]
        })
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
  Effect.gen(function* () {
    yield* requirePermission(read)
    const rows = yield* orgQuery((db, organizationId) =>
      db.query.payment.findMany({
        where: and(
          eq(payment.organizationId, organizationId),
          inArray(payment.status, [...statusesFor[filter]]),
        ),
        orderBy: [desc(payment.bookingDate), desc(payment.createdAt)],
      }),
    )
    const allocated = yield* paymentAllocations(rows)
    // The avier a payment settled, or for one needing review the avi its OCR points at. Their
    // details are shown only to those who may read invoices.
    const canReadInvoices = yield* hasPermission({ invoice: ['read'] })
    const suggested = canReadInvoices
      ? yield* invoicesForOcrs(rows.map((r) => r.reference))
      : new Map()
    const allocatedIds = [...allocated.values()].flatMap((a) =>
      a.allocations.map((x) => x.invoiceId),
    )
    const labels = canReadInvoices
      ? yield* invoiceLabels(allocatedIds)
      : new Map<string, { id: string; number: number; recipientName: string }>()
    return rows.map((r) => {
      const { allocations, unallocatedOre } = allocated.get(r.id) ?? {
        allocations: [],
        unallocatedOre: r.amountOre,
      }
      const ocr = r.reference?.replace(/\D/g, '') ?? ''
      const first = allocations[0] ? labels.get(allocations[0].invoiceId) : suggested.get(ocr)
      return {
        ...r,
        unallocatedOre,
        allocations: canReadInvoices
          ? allocations.map((a) => ({ ...a, number: labels.get(a.invoiceId)?.number ?? 0 }))
          : [],
        invoice: first
          ? { id: first.id, number: first.number, recipientName: first.recipientName }
          : null,
      }
    })
  })

export const listPaymentImports = requirePermission(read).pipe(
  Effect.andThen(
    orgQuery((db, organizationId) =>
      db.query.paymentImport.findMany({
        where: eq(paymentImport.organizationId, organizationId),
        orderBy: desc(paymentImport.createdAt),
        limit: 20,
      }),
    ),
  ),
)

/** Invoices a payment can be linked to by hand: not voided, with something still owed. */
export const listOpenInvoices = requirePermission({ ...book, invoice: ['read', 'manage'] }).pipe(
  Effect.andThen(
    Effect.gen(function* () {
      const rows = yield* orgQuery((db, organizationId) =>
        db
          .select({
            id: invoice.id,
            number: invoice.number,
            ocr: invoice.ocr,
            recipientName: invoice.recipientName,
            dueDate: invoice.dueDate,
          })
          .from(invoice)
          .where(and(eq(invoice.organizationId, organizationId), isNull(invoice.voidedAt)))
          .orderBy(desc(invoice.number)),
      )
      const moneyOf = yield* allInvoiceMoney
      return rows
        .map((r) => ({ ...r, owedOre: moneyOf(r.id).owedOre }))
        .filter((r) => r.owedOre > 0)
    }),
  ),
)

/** Avier by OCR number, with what they still owe, for matching payments. */
const invoicesForOcrs = (references: readonly (string | null)[]) =>
  Effect.gen(function* () {
    const ocrs = [...new Set(references.map((r) => r?.replace(/\D/g, '') ?? '').filter(Boolean))]
    const found: (typeof invoice.$inferSelect)[] = []
    for (const batch of chunks(ocrs, IN_CHUNK)) {
      found.push(
        ...(yield* orgQuery((db, organizationId) =>
          db
            .select()
            .from(invoice)
            .where(and(eq(invoice.organizationId, organizationId), inArray(invoice.ocr, batch))),
        )),
      )
    }
    const money = yield* invoiceMoneyFor(found.map((i) => i.id))
    const on = yield* today
    return new Map(
      found.map((i) => {
        const m = money.get(i.id) as InvoiceMoney
        const status = statusFromMoney(i, m, on)
        const matching: InvoiceForMatching & {
          recipientName: string
          partyId: string
          agreementId: string
        } = {
          id: i.id,
          number: i.number,
          ocr: i.ocr,
          owedOre: m.owedOre,
          status: status === 'unpaid' || status === 'overdue' ? 'open' : status,
          paidOn: m.paidOn,
          recipientName: i.recipientName,
          partyId: i.partyId,
          agreementId: i.agreementId,
        }
        return [i.ocr, matching]
      }),
    )
  })

/** Number and recipient of avier, to label what payments settled. */
const invoiceLabels = (invoiceIds: readonly string[]) =>
  Effect.gen(function* () {
    const rows: { id: string; number: number; recipientName: string }[] = []
    for (const batch of chunks([...new Set(invoiceIds)], IN_CHUNK)) {
      rows.push(
        ...(yield* orgQuery((db, organizationId) =>
          db
            .select({
              id: invoice.id,
              number: invoice.number,
              recipientName: invoice.recipientName,
            })
            .from(invoice)
            .where(and(eq(invoice.organizationId, organizationId), inArray(invoice.id, batch))),
        )),
      )
    }
    return new Map(rows.map((r) => [r.id, r]))
  })

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

/**
 * Matches a payment that needs attention to an open avi by hand: what is still unallocated of
 * it settles the avi. More than is owed leaves the avi overpaid, to be paid back.
 */
export const assignPayment = (input: AssignPaymentInput) =>
  Effect.gen(function* () {
    yield* requirePermission(book)
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
    const money = (yield* invoiceMoneyFor([inv.id])).get(inv.id) as InvoiceMoney
    if (money.owedOre <= 0) {
      return yield* new Conflict({
        message:
          money.paidOre > 0
            ? `Avi ${inv.number} är redan betald`
            : `Avi ${inv.number} är krediterad`,
      })
    }
    const { unallocatedOre } = (yield* paymentAllocations([p])).get(p.id) ?? {
      unallocatedOre: p.amountOre,
    }
    if (unallocatedOre <= 0)
      return yield* new Conflict({ message: 'Betalningen är redan fördelad' })

    yield* orgQuery((db, organizationId) =>
      db.batch([
        db
          .update(payment)
          .set({
            status: 'matched',
            note:
              unallocatedOre === money.owedOre
                ? 'Kopplad manuellt'
                : `Kopplad manuellt (${p.note ?? 'avvikande belopp'})`,
          })
          .where(and(eq(payment.id, p.id), eq(payment.organizationId, organizationId))),
        ...postingStatements(
          db,
          organizationId,
          {
            date: p.bookingDate,
            kind: 'allocation',
            description: `Betalning av avi ${inv.number}`,
            invoiceId: inv.id,
            paymentId: p.id,
          },
          allocationEntries(p.id, inv.id, unallocatedOre),
          inv,
        ),
      ]),
    )
  })

/** For payments that are not rent, e.g. a deposit or a refund handled elsewhere. */
export const ignorePayment = (paymentId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const p = yield* getPayment(paymentId)
    if (p.status === 'matched') {
      return yield* new Conflict({ message: 'Ångra kopplingen innan du ignorerar betalningen' })
    }
    // An ignored payment stays unallocated in the ledger; it is handled outside the avier.
    yield* setPayment(p.id, { status: 'ignored' })
  })

/** Puts a matched or ignored payment back for handling; reverses what it settled. */
export const undoPayment = (paymentId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(book)
    const p = yield* getPayment(paymentId)
    if (p.status !== 'matched' && p.status !== 'ignored') {
      return yield* new Conflict({ message: 'Betalningen är inte hanterad' })
    }
    const live = yield* livePostings({ kinds: ['allocation'], paymentIds: [p.id] })
    const on = yield* today
    yield* orgQuery((db, organizationId) =>
      db.batch([
        db
          .update(payment)
          .set({ status: 'unmatched', note: null })
          .where(and(eq(payment.id, p.id), eq(payment.organizationId, organizationId))),
        ...reversalStatements(db, organizationId, live, on, () => 'Ångrad koppling av inbetalning'),
      ]),
    )
  })
