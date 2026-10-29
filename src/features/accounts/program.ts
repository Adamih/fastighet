import { desc, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { Effect } from 'effect'
import { ledgerEntry, party, posting } from '#/db/schema'
import type { PostingKind } from '#/features/ledger/kinds'
import { refundEntries } from '#/features/ledger/postings'
import {
  creditBalances,
  openAvierFor,
  postingStatements,
  reversalStatements,
} from '#/features/ledger/program'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { today } from '#/server/today'
import type { RefundCreditInput } from './schemas'

// A party's account (kundreskontra per hyresgäst): what they owe across their avier, their credit
// balance (tillgodo), and every posting that changed it. Paying credit back needs the same
// permissions as booking payments.

const read: Permissions = { invoice: ['read'] }
const refund: Permissions = { invoice: ['manage'], payment: ['manage'] }

const findParty = (partyId: string) =>
  Effect.gen(function* () {
    const row = yield* orgQuery((db, organizationId) =>
      db.query.party.findFirst({
        columns: { id: true, name: true },
        where: inCompany(party, organizationId, eq(party.id, partyId)),
      }),
    ).pipe(orNotFound('party', partyId))
    return row
  })

const reversedBy = alias(posting, 'reversed_by')

/** Refunds of the party's credit balance that haven't been undone, newest first. */
const liveRefunds = (partyId: string) =>
  Effect.gen(function* () {
    const rows = yield* orgQuery((db, organizationId) =>
      db
        .select({ posting, entry: ledgerEntry })
        .from(posting)
        .innerJoin(ledgerEntry, eq(ledgerEntry.postingId, posting.id))
        .leftJoin(reversedBy, eq(reversedBy.reversesPostingId, posting.id))
        .where(
          inCompany(
            posting,
            organizationId,
            eq(posting.kind, 'refund'),
            isNull(posting.invoiceId),
            isNull(posting.reversesPostingId),
            isNull(reversedBy.id),
          ),
        )
        .orderBy(desc(posting.date), desc(posting.createdAt)),
    )
    const mine = new Set(rows.filter((r) => r.entry.partyId === partyId).map((r) => r.posting.id))
    const grouped = new Map<
      string,
      { posting: typeof posting.$inferSelect; entries: (typeof ledgerEntry.$inferSelect)[] }
    >()
    for (const r of rows) {
      if (!mine.has(r.posting.id)) continue
      const group = grouped.get(r.posting.id) ?? { posting: r.posting, entries: [] }
      group.entries.push(r.entry)
      grouped.set(r.posting.id, group)
    }
    return [...grouped.values()]
  })

/**
 * The party's account: what their open avier owe, their credit balance, and the postings that
 * changed their balance, newest first with the balance after each (positive: owed; negative:
 * credit). Moves between an avi and the credit balance don't change it and aren't listed.
 */
export const partyAccount = Effect.fn('accounts.partyAccount')(function* (partyId: string) {
  yield* requirePermission(read)
  const who = yield* findParty(partyId)
  const open = (yield* openAvierFor([who.id])).get(who.id) ?? []
  const creditOre = (yield* creditBalances([who.id])).get(who.id) ?? 0
  const rows = yield* orgQuery((db, organizationId) =>
    db
      .select({
        postingId: posting.id,
        date: posting.date,
        kind: posting.kind,
        description: posting.description,
        createdAt: posting.createdAt,
        invoiceId: posting.invoiceId,
        amountOre: ledgerEntry.amountOre,
      })
      .from(ledgerEntry)
      .innerJoin(posting, eq(posting.id, ledgerEntry.postingId))
      .where(
        inCompany(
          ledgerEntry,
          organizationId,
          eq(ledgerEntry.account, 'receivable'),
          eq(ledgerEntry.partyId, who.id),
        ),
      ),
  )
  const byPosting = new Map<
    string,
    {
      date: string
      kind: PostingKind
      description: string
      createdAt: number
      invoiceId: string | null
      amountOre: number
    }
  >()
  for (const r of rows) {
    const item = byPosting.get(r.postingId) ?? {
      date: r.date,
      kind: r.kind,
      description: r.description,
      createdAt: r.createdAt.getTime(),
      invoiceId: r.invoiceId,
      amountOre: 0,
    }
    item.amountOre += r.amountOre
    byPosting.set(r.postingId, item)
  }
  let balance = 0
  const history = [...byPosting.entries()]
    .filter(([, p]) => p.amountOre !== 0)
    .sort(([, a], [, b]) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .map(([id, p]) => {
      balance += p.amountOre
      return { id, ...p, balanceOre: balance }
    })
    .reverse()
  const refunds = yield* liveRefunds(who.id)
  return {
    party: who,
    owedOre: open.reduce((s, a) => s + a.owedOre, 0),
    creditOre,
    openAvier: open.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    history,
    lastRefund: refunds[0]
      ? {
          date: refunds[0].posting.date,
          amountOre: refunds[0].entries.find((e) => e.account === 'receivable')?.amountOre ?? 0,
        }
      : null,
  }
})

/** "Betala tillbaka": records that the party's whole credit balance was paid back. */
export const refundCredit = Effect.fn('accounts.refundCredit')(function* (
  input: RefundCreditInput,
) {
  yield* requirePermission(refund)
  const who = yield* findParty(input.partyId)
  if (input.refundedOn > (yield* today)) {
    return yield* new Conflict({ message: 'Datumet kan inte vara i framtiden' })
  }
  const creditOre = (yield* creditBalances([who.id])).get(who.id) ?? 0
  if (creditOre <= 0)
    return yield* new Conflict({ message: 'Det finns inget tillgodo att betala tillbaka' })
  yield* orgQuery((db, organizationId) => {
    const [first, ...rest] = postingStatements(
      db,
      organizationId,
      { date: input.refundedOn, kind: 'refund', description: 'Återbetalning av tillgodo' },
      refundEntries(creditOre),
      { partyId: who.id, agreementId: null },
    )
    return db.batch([first, ...rest])
  })
})

/** Undoes the party's latest refund: the amount is their credit balance again. */
export const undoCreditRefund = Effect.fn('accounts.undoCreditRefund')(function* (partyId: string) {
  yield* requirePermission(refund)
  const who = yield* findParty(partyId)
  const [latest] = yield* liveRefunds(who.id)
  if (!latest) return yield* new Conflict({ message: 'Ingen återbetalning är registrerad' })
  const on = yield* today
  yield* orgQuery((db, organizationId) => {
    const [first, ...rest] = reversalStatements(
      db,
      organizationId,
      [latest],
      on,
      () => 'Ångrad återbetalning av tillgodo',
    )
    return db.batch([first, ...rest])
  })
})
