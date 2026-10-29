import { addMonths, maxDate } from '#/lib/dates'

// How long an agreement shows in Mina sidor (pure, client-safe). Current agreements always do.
// An ended one shows while money is open on it (something owed, or a credit balance), and for a
// while after that, so a former tenant can settle up and see what happened.

/** How long an ended agreement stays visible once nothing is open. */
export const ENDED_VISIBLE_MONTHS = 12

export function agreementVisible(
  agreement: {
    /** The last billed day; null while it runs. */
    readonly endDate: string | null
    /** Something owed, or a credit balance, on the agreement. */
    readonly moneyOpen: boolean
    /** The latest money movement on it, if any. */
    readonly lastMoneyOn: string | null
  },
  today: string,
): boolean {
  if (agreement.endDate === null || agreement.endDate >= today || agreement.moneyOpen) return true
  const closed = agreement.lastMoneyOn
    ? maxDate(agreement.endDate, agreement.lastMoneyOn)
    : agreement.endDate
  return today <= addMonths(closed, ENDED_VISIBLE_MONTHS)
}
