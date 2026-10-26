import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import type { Db } from '#/db'
import { invoice, ledgerEntry, posting } from '#/db/schema'
import { orgQuery } from '#/server/scoped'
import type { PostingKind } from './kinds'
import { type EntryDraft, type InvoiceMoney, invoiceMoney, reversal } from './postings'

// Server helpers for the receivables ledger. Programs build postings with the pure rules in
// `postings.ts` and write them with `postingStatements`, in the same batch as the document or
// change they record. Nothing here checks permissions; the calling program has.

/** D1 allows 100 bound values per statement; `IN (...)` lists stay well below that. */
const IN_CHUNK = 50
const groupBy = <T>(items: readonly T[], key: (item: T) => string) => {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = groups.get(k)
    if (list) list.push(item)
    else groups.set(k, [item])
  }
  return groups
}

const chunks = <T>(items: readonly T[], size = IN_CHUNK): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  )

export interface PostingDraft {
  readonly id?: string
  readonly date: string
  readonly kind: PostingKind
  readonly description: string
  readonly invoiceId?: string | null
  readonly creditNoteId?: string | null
  readonly paymentId?: string | null
  readonly reversesPostingId?: string | null
}

/**
 * The statements that write one posting and its entries. Entries on an avi (`invoiceId`) get
 * its party and agreement, so a party's balance can be summed.
 */
export function postingStatements(
  db: Db,
  organizationId: string,
  draft: PostingDraft,
  entries: readonly EntryDraft[],
  owner: { partyId: string; agreementId: string } | null = null,
) {
  const id = draft.id ?? crypto.randomUUID()
  return [
    db.insert(posting).values({ ...draft, id, organizationId }),
    db.insert(ledgerEntry).values(
      entries.map((e) => ({
        ...e,
        organizationId,
        postingId: id,
        partyId: e.invoiceId ? (owner?.partyId ?? null) : null,
        agreementId: e.invoiceId ? (owner?.agreementId ?? null) : null,
      })),
    ),
  ] as const
}

/** What each avi's receivable entries add up to (see `invoiceMoney`). Avier with no entries owe nothing. */
export const invoiceMoneyFor = (invoiceIds: readonly string[]) =>
  Effect.gen(function* () {
    const result = new Map<string, InvoiceMoney>()
    const rows: { invoiceId: string | null; kind: PostingKind; date: string; amountOre: number }[] =
      []
    for (const ids of chunks([...new Set(invoiceIds)])) {
      rows.push(
        ...(yield* orgQuery((db, organizationId) =>
          db
            .select({
              invoiceId: ledgerEntry.invoiceId,
              kind: posting.kind,
              date: posting.date,
              amountOre: ledgerEntry.amountOre,
            })
            .from(ledgerEntry)
            .innerJoin(posting, eq(posting.id, ledgerEntry.postingId))
            .where(
              and(
                eq(ledgerEntry.organizationId, organizationId),
                eq(ledgerEntry.account, 'receivable'),
                inArray(ledgerEntry.invoiceId, ids),
              ),
            ),
        )),
      )
    }
    const byInvoice = groupBy(rows, (r) => r.invoiceId ?? '')
    for (const id of invoiceIds) result.set(id, invoiceMoney(byInvoice.get(id) ?? []))
    return result
  })

/** Every avi's money in the company, for lists and overviews. */
export const allInvoiceMoney = Effect.gen(function* () {
  const rows = yield* orgQuery((db, organizationId) =>
    db
      .select({
        invoiceId: ledgerEntry.invoiceId,
        kind: posting.kind,
        date: posting.date,
        amountOre: ledgerEntry.amountOre,
      })
      .from(ledgerEntry)
      .innerJoin(posting, eq(posting.id, ledgerEntry.postingId))
      .where(
        and(eq(ledgerEntry.organizationId, organizationId), eq(ledgerEntry.account, 'receivable')),
      ),
  )
  const byInvoice = groupBy(rows, (r) => r.invoiceId ?? '')
  return (invoiceId: string) => invoiceMoney(byInvoice.get(invoiceId) ?? [])
})

const reversedBy = alias(posting, 'reversed_by')

/**
 * Postings of these kinds that touch an avi or a payment and haven't been reversed (and aren't
 * reversals themselves), with their entries, so they can be reversed or summed.
 */
export const livePostings = (filter: {
  kinds: readonly PostingKind[]
  invoiceId?: string
  paymentIds?: readonly string[]
}) =>
  Effect.gen(function* () {
    const rows = yield* orgQuery((db, organizationId) =>
      db
        .select({ posting, entry: ledgerEntry })
        .from(posting)
        .innerJoin(ledgerEntry, eq(ledgerEntry.postingId, posting.id))
        .leftJoin(reversedBy, eq(reversedBy.reversesPostingId, posting.id))
        .where(
          and(
            eq(posting.organizationId, organizationId),
            inArray(posting.kind, [...filter.kinds]),
            isNull(posting.reversesPostingId),
            isNull(reversedBy.id),
            filter.invoiceId ? eq(posting.invoiceId, filter.invoiceId) : undefined,
            filter.paymentIds ? inArray(posting.paymentId, [...filter.paymentIds]) : undefined,
          ),
        ),
    )
    const grouped = groupBy(rows, (r) => r.posting.id)
    return [...grouped.values()].map((group) => ({
      posting: group[0].posting,
      entries: group.map((g) => g.entry),
    }))
  })

export type LivePosting = Effect.Success<ReturnType<typeof livePostings>>[number]

/** The statements that reverse postings on `date`: the same entries negated, linked back. */
export function reversalStatements(
  db: Db,
  organizationId: string,
  postings: readonly LivePosting[],
  date: string,
  description: (original: LivePosting['posting']) => string,
  /** The reversal's kind; by default the original's, so sums by kind net out. */
  kind?: PostingKind,
) {
  return postings.flatMap(({ posting: original, entries }) => {
    const id = crypto.randomUUID()
    const drafts = reversal(
      entries.map((e) => ({
        account: e.account,
        amountOre: e.amountOre,
        invoiceId: e.invoiceId,
        paymentId: e.paymentId,
        chargeKind: e.chargeKind,
        vatRatePercent: e.vatRatePercent,
      })),
    )
    return [
      db.insert(posting).values({
        id,
        organizationId,
        date,
        kind: kind ?? original.kind,
        description: description(original),
        invoiceId: original.invoiceId,
        creditNoteId: original.creditNoteId,
        paymentId: original.paymentId,
        reversesPostingId: original.id,
      }),
      db.insert(ledgerEntry).values(
        drafts.map((e, i) => ({
          ...e,
          organizationId,
          postingId: id,
          partyId: entries[i]?.partyId ?? null,
          agreementId: entries[i]?.agreementId ?? null,
        })),
      ),
    ]
  })
}

/**
 * What each payment is matched to: the avier its live allocations settle, with amounts, and
 * what is still unallocated.
 */
export const paymentAllocations = (payments: readonly { id: string; amountOre: number }[]) =>
  Effect.gen(function* () {
    const allocations = new Map<string, { invoiceId: string; amountOre: number }[]>()
    for (const batch of chunks(payments.map((p) => p.id))) {
      for (const { posting: p, entries } of yield* livePostings({
        kinds: ['allocation'],
        paymentIds: batch,
      })) {
        const receivable = entries.find((e) => e.account === 'receivable')
        if (!p.paymentId || !receivable?.invoiceId) continue
        const list = allocations.get(p.paymentId) ?? []
        list.push({ invoiceId: receivable.invoiceId, amountOre: -receivable.amountOre })
        allocations.set(p.paymentId, list)
      }
    }
    return new Map(
      payments.map((p) => {
        const list = allocations.get(p.id) ?? []
        const allocatedOre = list.reduce((s, a) => s + a.amountOre, 0)
        return [p.id, { allocations: list, unallocatedOre: p.amountOre - allocatedOre }]
      }),
    )
  })

/** The avi's party and agreement, for entries on its receivable. */
export const invoiceOwner = (invoiceId: string) =>
  orgQuery((db, organizationId) =>
    db
      .select({ partyId: invoice.partyId, agreementId: invoice.agreementId })
      .from(invoice)
      .where(and(eq(invoice.id, invoiceId), eq(invoice.organizationId, organizationId))),
  ).pipe(Effect.map(([row]) => row ?? null))
