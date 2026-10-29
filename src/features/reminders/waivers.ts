import { and, eq, gt, inArray, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Db } from '#/db'
import { paymentReminder } from '#/db/schema'
import { creditTransferEntries, type ReceivableEntry } from '#/features/ledger/postings'
import {
  type LivePosting,
  livePostings,
  postingStatements,
  receivableEntriesFor,
  reversalStatements,
} from '#/features/ledger/program'
import { loadCompanyDetails } from '#/features/settings/program'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { automaticFeeWaiver, type FeeWaiver, waivedFeeToCredit } from './rules'

// Waiving reminder fees: the statements that reverse a fee's posting, move what was paid of it
// to the party's credit balance, and record why on the reminder. Payment programs call
// `feeWaiverStatements` with the entries they are about to write; "Stryk avgiften" waives by hand.
// Nothing here checks permissions; the calling program has.

/** D1 allows 100 bound values per statement; `IN (...)` lists stay well below that. */
const IN_CHUNK = 50

export const reminderSettings = Effect.map(loadCompanyDetails, (s) => ({
  reminderFeeOre: s.reminderFeeOre,
  reminderIntervalDays: s.reminderIntervalDays,
  reminderDueDays: s.reminderDueDays,
  waiveReminderFeeByDueDate: s.waiveReminderFeeByDueDate,
}))

export interface StandingFee {
  readonly reminder: { id: string; sentOn: string; dueDate: string; feeOre: number }
  readonly posting: LivePosting
}

/** Each avi's reminder fee that still stands (charged, not waived), with its live posting. */
export const standingFees = (invoiceIds: readonly string[]) =>
  Effect.gen(function* () {
    const result = new Map<string, StandingFee>()
    const ids = [...new Set(invoiceIds)]
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const batch = ids.slice(i, i + IN_CHUNK)
      const reminders = yield* orgQuery((db, organizationId) =>
        db
          .select({
            id: paymentReminder.id,
            invoiceId: paymentReminder.invoiceId,
            sentOn: paymentReminder.sentOn,
            dueDate: paymentReminder.dueDate,
            feeOre: paymentReminder.feeOre,
          })
          .from(paymentReminder)
          .where(
            and(
              eq(paymentReminder.organizationId, organizationId),
              inArray(paymentReminder.invoiceId, batch),
              gt(paymentReminder.feeOre, 0),
              isNull(paymentReminder.feeWaivedOn),
            ),
          ),
      )
      if (reminders.length === 0) continue
      const postings = yield* livePostings({ kinds: ['reminder'], invoiceIds: batch })
      // An avi's fee comes with its first reminder only, so there is one of each per avi.
      for (const { invoiceId, ...reminder } of reminders) {
        const posting = postings.find((p) => p.posting.invoiceId === invoiceId)
        if (posting) result.set(invoiceId, { reminder, posting })
      }
    }
    return result
  })

/**
 * The statements that waive a fee on `on`: the reversal of its posting, what was paid of it to
 * the party's credit balance (`owedOre` is what the avi owes with the fee), and why on the
 * reminder.
 */
export function waiveStatements(
  db: Db,
  organizationId: string,
  invoiceId: string,
  fee: StandingFee,
  why: FeeWaiver,
  owedOre: number,
  on: string,
) {
  const receivable = fee.posting.entries.find((e) => e.account === 'receivable')
  const owner = receivable?.partyId
    ? { partyId: receivable.partyId, agreementId: receivable.agreementId }
    : null
  const toCreditOre = waivedFeeToCredit(owedOre, fee.reminder.feeOre)
  return [
    ...reversalStatements(
      db,
      organizationId,
      [fee.posting],
      on,
      (original) => `Struken: ${original.description}`,
    ),
    ...(toCreditOre > 0
      ? postingStatements(
          db,
          organizationId,
          {
            date: on,
            kind: 'credit_transfer',
            description: 'Struken påminnelseavgift till tillgodo',
            invoiceId,
          },
          creditTransferEntries(invoiceId, toCreditOre),
          owner,
        )
      : []),
    db
      .update(paymentReminder)
      .set({ feeWaivedOn: on, feeWaiver: why })
      .where(
        and(
          eq(paymentReminder.id, fee.reminder.id),
          eq(paymentReminder.organizationId, organizationId),
        ),
      ),
  ]
}

const total = (entries: readonly ReceivableEntry[]) => entries.reduce((s, e) => s + e.amountOre, 0)

/**
 * For payments about to settle avier (`planned`: the receivable entries they will write, per
 * avi), the statements that waive the fees that then no longer stand (`automaticFeeWaiver`),
 * per avi, to write in the same batch as the payment.
 */
export const feeWaiverStatements = (planned: ReadonlyMap<string, readonly ReceivableEntry[]>) =>
  Effect.gen(function* () {
    const builders = new Map<
      string,
      (db: Db, organizationId: string) => ReturnType<typeof waiveStatements>
    >()
    const fees = yield* standingFees([...planned.keys()])
    if (fees.size === 0) return builders
    const settings = yield* reminderSettings
    const existing = yield* receivableEntriesFor([...fees.keys()])
    const on = yield* today
    for (const [invoiceId, fee] of fees) {
      const entries = [...(existing.get(invoiceId) ?? []), ...(planned.get(invoiceId) ?? [])]
      const why = automaticFeeWaiver(entries, fee.reminder, settings)
      if (!why) continue
      builders.set(invoiceId, (db, organizationId) =>
        waiveStatements(db, organizationId, invoiceId, fee, why, total(entries), on),
      )
    }
    return builders
  })
