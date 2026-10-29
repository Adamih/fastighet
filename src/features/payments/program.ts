import { and, desc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Db } from '#/db'
import { invoice, party, payment, paymentImport } from '#/db/schema'
import type { ReceivableEntry } from '#/features/ledger/postings'
import {
  allocationEntries,
  creditAllocationEntries,
  paymentEntries,
} from '#/features/ledger/postings'
import {
  creditBalances,
  invoiceMoneyFor,
  livePostings,
  openAvierFor,
  paymentAllocations,
  postingStatements,
  reversalStatements,
} from '#/features/ledger/program'
import { feeWaiverStatements, type StandingFee, standingFees } from '#/features/reminders/waivers'
import { formatSek } from '#/lib/money'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { CurrentUser } from '#/server/services'
import { today } from '#/server/today'
import { Camt054Error, parseCamt054 } from './camt054'
import { type Allocation, allocate, matchPayments } from './matching'
import type { AssignPaymentInput, ImportPaymentsInput, PaymentFilter } from './schemas'

/** D1 allows 100 bound parameters per statement; `IN (...)` lists stay well below that. */
const IN_CHUNK = 50
/** Statements per D1 batch. A payment's statements always share a batch. */
const BATCH_STATEMENTS = 50

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  )

const read: Permissions = { payment: ['read'] }
const manage: Permissions = { payment: ['manage'] }
/** Booking a payment changes whether an invoice is paid, so it needs both. */
const book: Permissions = { payment: ['manage'], invoice: ['manage'] }

/** What allocations need about each avi: its number and owner. */
type AviOwner = { number: number; partyId: string; agreementId: string }

/**
 * The postings that split a payment: one allocation per avi, and the rest to the party's credit
 * balance. `creditOwner` is whose credit balance it is.
 */
function allocationStatements(
  db: Db,
  organizationId: string,
  p: { id: string; bookingDate: string },
  allocations: readonly Allocation[],
  owners: ReadonlyMap<string, AviOwner>,
  creditOwner: { partyId: string; agreementId: string | null },
) {
  return allocations.flatMap((a) => {
    if (a.invoiceId === null) {
      return postingStatements(
        db,
        organizationId,
        {
          date: p.bookingDate,
          kind: 'allocation',
          description: 'Inbetalning till tillgodo',
          paymentId: p.id,
        },
        creditAllocationEntries(p.id, a.amountOre),
        creditOwner,
      )
    }
    const owner = owners.get(a.invoiceId)
    if (!owner) throw new Error(`No owner for avi ${a.invoiceId}`)
    return postingStatements(
      db,
      organizationId,
      {
        date: p.bookingDate,
        kind: 'allocation',
        description: `Betalning av avi ${owner.number}`,
        invoiceId: a.invoiceId,
        paymentId: p.id,
      },
      allocationEntries(p.id, a.invoiceId, a.amountOre),
      owner,
    )
  })
}

/**
 * What allocations will write on each avi's receivable, dated by the payments' booking dates,
 * so reminder fees they make waived (`feeWaiverStatements`) can be waived in the same batch.
 */
function plannedEntries(
  payments: readonly { bookingDate: string; allocations: readonly Allocation[] }[],
) {
  const planned = new Map<string, ReceivableEntry[]>()
  for (const p of payments) {
    for (const a of p.allocations) {
      if (a.invoiceId === null) continue
      const list = planned.get(a.invoiceId) ?? []
      list.push({ kind: 'allocation', date: p.bookingDate, amountOre: -a.amountOre })
      planned.set(a.invoiceId, list)
    }
  }
  return planned
}

/** Number and owner of avier, for allocation postings and labels. */
const aviOwners = (invoiceIds: readonly string[]) =>
  Effect.gen(function* () {
    const rows: ({ id: string; recipientName: string } & AviOwner)[] = []
    for (const batch of chunks([...new Set(invoiceIds)], IN_CHUNK)) {
      rows.push(
        ...(yield* orgQuery((db, organizationId) =>
          db
            .select({
              id: invoice.id,
              number: invoice.number,
              partyId: invoice.partyId,
              agreementId: invoice.agreementId,
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

    // The avi each OCR names tells whose payment it is; their open avier decide the split.
    const named = yield* avierForOcrs(fresh.map((p) => p.reference))
    const partyIds = [...new Set([...named.values()].map((a) => a.partyId))]
    const open = yield* openAvierFor(partyIds)
    const results = matchPayments(fresh, named, open)
    const owners = yield* aviOwners([
      ...[...named.values()].map((a) => a.id),
      ...[...open.values()].flat().map((a) => a.id),
    ])
    // A fee a payment waives is waived with the last payment in the file that settles its avi.
    const waivers = yield* feeWaiverStatements(
      plannedEntries(fresh.map((p, i) => ({ ...p, allocations: results[i].allocations }))),
    )
    const lastSettling = new Map<string, number>()
    results.forEach((r, i) => {
      for (const a of r.allocations) if (a.invoiceId) lastSettling.set(a.invoiceId, i)
    })
    const waiverAt = new Map<number, string[]>()
    for (const invoiceId of waivers.keys()) {
      const last = lastSettling.get(invoiceId) ?? -1
      waiverAt.set(last, [...(waiverAt.get(last) ?? []), invoiceId])
    }

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

    // A payment, its posting and its allocations always land in the same batch, so a failure
    // part-way leaves no half-booked payment; importing the file again picks up the rest.
    const perPayment = (db: Db, organizationId: string) =>
      fresh.map((p, i) => {
        const match = results[i]
        const id = crypto.randomUUID()
        const ocr = p.reference?.replace(/\D/g, '') ?? ''
        const namedAvi = named.get(ocr)
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
          }),
          ...postingStatements(
            db,
            organizationId,
            { date: p.bookingDate, kind: 'payment', description: 'Inbetalning', paymentId: id },
            paymentEntries(id, p.amountOre),
          ),
          ...(match.partyId && namedAvi
            ? allocationStatements(
                db,
                organizationId,
                { id, bookingDate: p.bookingDate },
                match.allocations,
                owners,
                { partyId: match.partyId, agreementId: namedAvi.agreementId },
              )
            : []),
          ...(waiverAt.get(i) ?? []).flatMap(
            (invoiceId) => waivers.get(invoiceId)?.(db, organizationId) ?? [],
          ),
        ]
      })
    yield* orgQuery(async (db, organizationId) => {
      let batch: ReturnType<typeof perPayment>[number] = []
      for (const statements of perPayment(db, organizationId)) {
        if (batch.length > 0 && batch.length + statements.length > BATCH_STATEMENTS) {
          const [first, ...rest] = batch
          await db.batch([first, ...rest])
          batch = []
        }
        batch = [...batch, ...statements]
      }
      if (batch.length > 0) {
        const [first, ...rest] = batch
        await db.batch([first, ...rest])
      }
    })

    const matched = results.filter((r) => r.status === 'matched')
    return {
      importId,
      imported: fresh.length,
      matched: matched.length,
      /** Matched payments that left something on a party's credit balance. */
      toCredit: matched.filter((r) => r.allocations.some((a) => a.invoiceId === null)).length,
      unmatched: results.length - matched.length,
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
    // Where a payment went, or for one waiting the avi its OCR names. Avi details are shown
    // only to those who may read invoices.
    const canReadInvoices = yield* hasPermission({ invoice: ['read'] })
    const named = canReadInvoices
      ? yield* avierForOcrs(rows.map((r) => r.reference))
      : new Map<string, NamedAvi>()
    const labels = canReadInvoices
      ? yield* aviOwners(
          [...allocated.values()].flatMap((a) =>
            a.allocations.flatMap((x) => (x.invoiceId ? [x.invoiceId] : [])),
          ),
        )
      : new Map<string, { id: string; recipientName: string } & AviOwner>()
    // Avier a payment settled except for their reminder fee, so it can be waived from here.
    const settledIds = [...labels.keys()]
    const fees =
      settledIds.length > 0 ? yield* standingFees(settledIds) : new Map<string, StandingFee>()
    const money = yield* invoiceMoneyFor([...fees.keys()])
    const feeLeftOre = (invoiceId: string | null) => {
      const fee = invoiceId ? fees.get(invoiceId) : undefined
      const owedOre = invoiceId ? (money.get(invoiceId)?.owedOre ?? 0) : 0
      return fee && owedOre > 0 && owedOre <= fee.reminder.feeOre ? owedOre : 0
    }
    return rows.map((r) => {
      const { allocations, unallocatedOre } = allocated.get(r.id) ?? {
        allocations: [],
        unallocatedOre: r.amountOre,
      }
      const ocr = r.reference?.replace(/\D/g, '') ?? ''
      const firstAvi = allocations.find((a) => a.invoiceId)?.invoiceId
      const first = firstAvi ? labels.get(firstAvi) : named.get(ocr)
      return {
        ...r,
        unallocatedOre,
        allocations: canReadInvoices
          ? allocations.map((a) => ({
              ...a,
              number: a.invoiceId ? (labels.get(a.invoiceId)?.number ?? 0) : undefined,
              /** What is left on the avi when that is only (part of) its reminder fee. */
              feeLeftOre: feeLeftOre(a.invoiceId),
            }))
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

/**
 * Who a payment can be matched to by hand: everyone who has received an avi, with what they
 * owe. Their names are on the avier, so reading invoices is enough.
 */
export const listPayers = requirePermission({ ...book, invoice: ['read', 'manage'] }).pipe(
  Effect.andThen(
    Effect.gen(function* () {
      const rows = yield* orgQuery((db, organizationId) =>
        db
          .selectDistinct({ id: party.id, name: party.name })
          .from(invoice)
          .innerJoin(party, eq(party.id, invoice.partyId))
          .where(eq(invoice.organizationId, organizationId))
          .orderBy(party.name),
      )
      const open = yield* openAvierFor(rows.map((r) => r.id))
      return rows.map((r) => ({
        ...r,
        owedOre: (open.get(r.id) ?? []).reduce((s, a) => s + a.owedOre, 0),
      }))
    }),
  ),
)

type NamedAvi = {
  id: string
  number: number
  partyId: string
  agreementId: string
  recipientName: string
}

/** The avi each OCR number names (any avi, paid or not), for finding whose payment it is. */
const avierForOcrs = (references: readonly (string | null)[]) =>
  Effect.gen(function* () {
    const ocrs = [...new Set(references.map((r) => r?.replace(/\D/g, '') ?? '').filter(Boolean))]
    const found = new Map<string, NamedAvi>()
    for (const batch of chunks(ocrs, IN_CHUNK)) {
      const rows = yield* orgQuery((db, organizationId) =>
        db
          .select({
            id: invoice.id,
            ocr: invoice.ocr,
            number: invoice.number,
            partyId: invoice.partyId,
            agreementId: invoice.agreementId,
            recipientName: invoice.recipientName,
          })
          .from(invoice)
          .where(and(eq(invoice.organizationId, organizationId), inArray(invoice.ocr, batch))),
      )
      for (const { ocr, ...row } of rows) found.set(ocr, row)
    }
    return found
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

/** How a waiting payment would be split if matched to `partyId`: oldest avi first, then credit. */
const planAssignment = (input: AssignPaymentInput) =>
  Effect.gen(function* () {
    const p = yield* getPayment(input.paymentId)
    if (p.status === 'matched') {
      return yield* new Conflict({ message: 'Betalningen är redan kopplad' })
    }
    const payer = yield* orgQuery((db, organizationId) =>
      db.query.party.findFirst({
        columns: { id: true, name: true },
        where: and(eq(party.id, input.partyId), eq(party.organizationId, organizationId)),
      }),
    )
    if (!payer) return yield* new NotFound({ entity: 'party', id: input.partyId })
    const { unallocatedOre } = (yield* paymentAllocations([p])).get(p.id) ?? {
      unallocatedOre: p.amountOre,
    }
    if (unallocatedOre <= 0) {
      return yield* new Conflict({ message: 'Betalningen är redan fördelad' })
    }
    const open = (yield* openAvierFor([payer.id])).get(payer.id) ?? []
    const allocations = allocate(unallocatedOre, open)
    const owners = yield* aviOwners(open.map((a) => a.id))
    return { p, payer, allocations, owners }
  })

/** "Koppla": where a waiting payment will go if matched to the party, before confirming. */
export const previewAssignment = (input: AssignPaymentInput) =>
  Effect.gen(function* () {
    yield* requirePermission(book)
    const { allocations, owners } = yield* planAssignment(input)
    return allocations.map((a) => ({
      ...a,
      number: a.invoiceId ? (owners.get(a.invoiceId)?.number ?? 0) : undefined,
    }))
  })

/**
 * Matches a waiting payment to a party by hand: what is unallocated of it settles their open
 * avier, oldest first, and the rest goes to their credit balance.
 */
export const assignPayment = (input: AssignPaymentInput) =>
  Effect.gen(function* () {
    yield* requirePermission(book)
    const { p, payer, allocations, owners } = yield* planAssignment(input)
    const agreementId = [...owners.values()][0]?.agreementId ?? null
    const waivers = yield* feeWaiverStatements(plannedEntries([{ ...p, allocations }]))
    yield* orgQuery((db, organizationId) => {
      const [first, ...rest] = [
        db
          .update(payment)
          .set({ status: 'matched', note: 'Kopplad manuellt' })
          .where(and(eq(payment.id, p.id), eq(payment.organizationId, organizationId))),
        ...allocationStatements(db, organizationId, p, allocations, owners, {
          partyId: payer.id,
          agreementId,
        }),
        ...[...waivers.values()].flatMap((waive) => waive(db, organizationId)),
      ]
      return db.batch([first, ...rest])
    })
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

/**
 * The statements that undo payments' allocations and put them back for handling. What a payment
 * put on a credit balance must still be there: credit already used on an avi or paid back can't
 * be taken back.
 */
export const undoPaymentStatements = (paymentIds: readonly string[], on: string) =>
  Effect.gen(function* () {
    const live = yield* livePostings({ kinds: ['allocation'], paymentIds })
    const toCredit = new Map<string, number>()
    for (const { entries } of live) {
      for (const e of entries) {
        if (e.account === 'receivable' && !e.invoiceId && e.partyId) {
          toCredit.set(e.partyId, (toCredit.get(e.partyId) ?? 0) - e.amountOre)
        }
      }
    }
    const balances = yield* creditBalances([...toCredit.keys()])
    for (const [partyId, amountOre] of toCredit) {
      const balance = balances.get(partyId) ?? 0
      if (balance < amountOre) {
        return yield* new Conflict({
          message: `Betalningen gav ${formatSek(amountOre)} tillgodo, men ${formatSek(amountOre - balance)} av det har redan räknats av på en avi eller betalats tillbaka. Det kan inte ångras.`,
        })
      }
    }
    return (db: Db, organizationId: string) => [
      db
        .update(payment)
        .set({ status: 'unmatched', note: null })
        .where(
          and(eq(payment.organizationId, organizationId), inArray(payment.id, [...paymentIds])),
        ),
      ...reversalStatements(db, organizationId, live, on, () => 'Ångrad koppling av inbetalning'),
    ]
  })

/** Puts a matched or ignored payment back for handling; reverses what it settled. */
export const undoPayment = (paymentId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(book)
    const p = yield* getPayment(paymentId)
    if (p.status !== 'matched' && p.status !== 'ignored') {
      return yield* new Conflict({ message: 'Betalningen är inte hanterad' })
    }
    const statements = yield* undoPaymentStatements([p.id], yield* today)
    yield* orgQuery((db, organizationId) => {
      const [first, ...rest] = statements(db, organizationId)
      return db.batch([first, ...rest])
    })
  })
