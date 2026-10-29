import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Db } from '#/db'
import { charge, paymentReminder } from '#/db/schema'
import { billingAvier } from '#/features/agreements/program'
import type { ReceivableEntry } from '#/features/ledger/postings'
import { receivableEntriesFor } from '#/features/ledger/program'
import { loadCompanyDetails } from '#/features/settings/program'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { automaticFeeWaiver, type FeeWaiver } from './rules'

// Waiving reminder fees. A fee is a one-off charge on the agreement until an avi bills it;
// waiving deletes the charge and records why on the reminder. Payment programs call
// `feeWaiverStatements` with the entries they are about to write; "Stryk avgiften" and removing
// the charge waive by hand. Once billed, a fee is corrected like any line: with a credit note.
// Nothing here checks permissions; the calling program has.

/** D1 allows 100 bound values per statement; `IN (...)` lists stay well below that. */
const IN_CHUNK = 50

export const reminderSettings = Effect.map(loadCompanyDetails, (s) => ({
  reminderFeeOre: s.reminderFeeOre,
  reminderIntervalDays: s.reminderIntervalDays,
  reminderDueDays: s.reminderDueDays,
  waiveReminderFeeByDueDate: s.waiveReminderFeeByDueDate,
}))

export interface PendingFee {
  readonly reminderId: string
  readonly chargeId: string
  readonly sentOn: string
  readonly dueDate: string
}

/** Each avi's reminder fee that no avi has billed yet and nobody has waived. */
export const pendingFees = (invoiceIds: readonly string[]) =>
  Effect.gen(function* () {
    const result = new Map<string, PendingFee>()
    const ids = [...new Set(invoiceIds)]
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const batch = ids.slice(i, i + IN_CHUNK)
      const rows = yield* orgQuery((db, organizationId) =>
        db
          .select({
            reminderId: paymentReminder.id,
            invoiceId: paymentReminder.invoiceId,
            chargeId: paymentReminder.feeChargeId,
            sentOn: paymentReminder.sentOn,
            dueDate: paymentReminder.dueDate,
          })
          .from(paymentReminder)
          .where(
            and(
              eq(paymentReminder.organizationId, organizationId),
              inArray(paymentReminder.invoiceId, batch),
              isNotNull(paymentReminder.feeChargeId),
              isNull(paymentReminder.feeWaivedOn),
            ),
          ),
      )
      const billed = yield* billingAvier(rows.map((r) => r.chargeId))
      for (const { invoiceId, chargeId, ...fee } of rows) {
        if (chargeId && !billed.has(chargeId)) result.set(invoiceId, { ...fee, chargeId })
      }
    }
    return result
  })

/** The statements that waive a pending fee on `on`: why on the reminder, then the charge goes. */
export const waiveStatements = (
  db: Db,
  organizationId: string,
  fee: { reminderId: string; chargeId: string },
  why: FeeWaiver,
  on: string,
) =>
  [
    db
      .update(paymentReminder)
      .set({ feeChargeId: null, feeWaivedOn: on, feeWaiver: why })
      .where(
        and(
          eq(paymentReminder.id, fee.reminderId),
          eq(paymentReminder.organizationId, organizationId),
        ),
      ),
    db
      .delete(charge)
      .where(and(eq(charge.id, fee.chargeId), eq(charge.organizationId, organizationId))),
  ] as const

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
    const fees = yield* pendingFees([...planned.keys()])
    if (fees.size === 0) return builders
    const settings = yield* reminderSettings
    const existing = yield* receivableEntriesFor([...fees.keys()])
    const on = yield* today
    for (const [invoiceId, fee] of fees) {
      const entries = [...(existing.get(invoiceId) ?? []), ...(planned.get(invoiceId) ?? [])]
      const why = automaticFeeWaiver(entries, fee, settings)
      if (!why) continue
      builders.set(invoiceId, (db, organizationId) =>
        waiveStatements(db, organizationId, fee, why, on),
      )
    }
    return builders
  })
