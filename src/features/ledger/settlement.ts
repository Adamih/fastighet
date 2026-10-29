import { Effect } from 'effect'
import type { Db } from '#/db'
import { lateInterestStatements } from '#/features/interest/program'
import { feeWaiverStatements } from '#/features/reminders/waivers'
import type { ReceivableEntry } from './postings'

/**
 * What settling avier brings along, per avi, to write in the same batch as the payment: the
 * reminder fees it waives (`feeWaiverStatements`) and the late interest it charges
 * (`lateInterestStatements`). `planned` is the receivable entries the payment will write, per
 * avi, dated by when the money arrived. Every program that settles avier with dated money (bank
 * import, "Koppla", payment by hand) goes through here.
 */
export const settlementStatements = Effect.fn('ledger.settlementStatements')(function* (
  planned: ReadonlyMap<string, readonly ReceivableEntry[]>,
) {
  const waivers = yield* feeWaiverStatements(planned)
  const interest = yield* lateInterestStatements(planned)
  const ids = new Set([...waivers.keys(), ...interest.keys()])
  return new Map(
    [...ids].map((id) => [
      id,
      (db: Db, organizationId: string) => [
        ...(waivers.get(id)?.(db, organizationId) ?? []),
        ...(interest.get(id)?.(db, organizationId) ?? []),
      ],
    ]),
  )
})
