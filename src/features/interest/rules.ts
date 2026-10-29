import type { ReceivableEntry } from '#/features/ledger/postings'
import { addDays } from '#/lib/dates'

// Pure rules for dröjsmålsränta (räntelagen 1975:635). Shared by the server and tests.
//
// An avi's due date is set in advance, so interest runs from the due date (6 §) at Riksbanken's
// reference rate for each half-year plus eight percentage points (9 §), simple interest per day
// on what is still owed. A payment on the due date is on time; the day it is paid late counts.
// What is owed is the avi's own debt: its amount less payments, credit and credit notes, never
// its reminder fee, which is a claim of its own.

/** Räntelagen 9 §: the reference rate plus eight percentage points. */
export const LATE_INTEREST_MARGIN_BASIS_POINTS = 800

/** A reference rate in force from `fromDate` until the next one. */
export interface ReferenceRate {
  readonly fromDate: string
  readonly basisPoints: number
}

/** The interest rate in force on `date`, in basis points, or null before the first known rate. */
export function lateInterestRateOn(rates: readonly ReferenceRate[], date: string): number | null {
  const rate = [...rates]
    .filter((r) => r.fromDate <= date)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate))
    .at(-1)
  return rate ? rate.basisPoints + LATE_INTEREST_MARGIN_BASIS_POINTS : null
}

/** Each half-year's rate applies only within it; a later half-year needs its own row. */
const halfYearOf = (date: string) => `${date.slice(0, 4)}-${date.slice(5, 7) <= '06' ? 1 : 2}`

const notDebt = new Set<ReceivableEntry['kind']>(['reminder'])

export type LateInterest =
  | {
      /** Whole kronor, rounded down. */
      readonly ore: number
      /** The days it ran: the day after the due date through the day it was paid. */
      readonly fromDate: string
      readonly toDate: string
      /** Days on which something was owed. */
      readonly days: number
    }
  /** No reference rate is known for this half-year yet. */
  | { readonly missingRateFor: string }

/**
 * The interest on an avi once its debt is settled, from its receivable entries (the ones about
 * to be written included): null while something is still owed, or when it was settled by the
 * due date. Each day after the due date accrues what was owed at the start of that day, so a
 * payment counts from the day after it.
 */
export function lateInterest(
  entries: readonly ReceivableEntry[],
  dueDate: string,
  rates: readonly ReferenceRate[],
): LateInterest | null {
  const debt = entries.filter((e) => !notDebt.has(e.kind))
  if (debt.reduce((s, e) => s + e.amountOre, 0) > 0) return null
  const settledOn = debt
    .filter((e) => e.amountOre < 0)
    .map((e) => e.date)
    .sort()
    .at(-1)
  if (!settledOn || settledOn <= dueDate) return null

  const fromDate = addDays(dueDate, 1)
  let accrued = 0
  let days = 0
  for (let day = fromDate; day <= settledOn; day = addDays(day, 1)) {
    const owed = debt.filter((e) => e.date < day).reduce((s, e) => s + e.amountOre, 0)
    if (owed <= 0) continue
    const rate = lateInterestRateOn(rates, day)
    const known = rates.some((r) => r.fromDate <= day && halfYearOf(r.fromDate) === halfYearOf(day))
    if (rate === null || !known) return { missingRateFor: halfYearOf(day) }
    accrued += (owed * rate) / 10_000 / 365
    days++
  }
  return { ore: Math.floor(accrued / 100) * 100, fromDate, toDate: settledOn, days }
}
