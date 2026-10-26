import { maxDate, minDate } from '#/lib/dates'
import { type Charge, currentBaseCharge } from './charges'
import { type Dated, inForce } from './periods'

// Pure helper for pages and lists: an agreement's terms as they stand on one day. Client-safe.

/**
 * The day to show an agreement on: today, or its first day if it hasn't started, or its last
 * billed day if it has ended.
 */
export function viewDate(agreement: { startDate: string; endDate: string | null }, today: string) {
  const from = maxDate(today, agreement.startDate)
  return agreement.endDate ? minDate(from, agreement.endDate) : from
}

/**
 * The parties, units and base charge in force on the view date. The base charge becomes the
 * familiar `rentOre`, `rentInterval` and `vat` (the fee, for a bostadsrätt).
 */
export function currentTerms<P extends Dated, U extends Dated, C extends Charge>(
  agreement: {
    startDate: string
    endDate: string | null
    parties: readonly P[]
    units: readonly U[]
    charges: readonly C[]
  },
  today: string,
) {
  const on = viewDate(agreement, today)
  const base = currentBaseCharge(agreement.charges, on)
  return {
    on,
    baseCharge: base,
    rentOre: base?.amountOre ?? 0,
    rentInterval: base?.interval === 'yearly' ? ('yearly' as const) : ('monthly' as const),
    vat: base?.vat ?? false,
    parties: inForce(agreement.parties, on),
    units: inForce(agreement.units, on),
  }
}

/** The rows in force on the view date, or else the open ones (or all), so a page is never empty. */
export const shownRows = <R extends { toDate: string | null }>(
  inForceRows: readonly R[],
  all: readonly R[],
): R[] => {
  if (inForceRows.length > 0) return [...inForceRows]
  const open = all.filter((r) => r.toDate === null)
  return open.length > 0 ? open : [...all]
}

/** The base charge in force on the view date, as the rent fields lists and pages show. */
export function rentFields(
  agreement: { startDate: string; endDate: string | null; charges: readonly Charge[] },
  today: string,
) {
  const base = currentBaseCharge(agreement.charges, viewDate(agreement, today))
  return {
    rentOre: base?.amountOre ?? 0,
    rentInterval: base?.interval === 'yearly' ? ('yearly' as const) : ('monthly' as const),
    vat: base?.vat ?? false,
  }
}
