import { addDays } from '#/lib/dates'

// Pure helpers for effective-dated terms: rows that apply from a date, and until a date or
// further notice. Charges, parties and units on an agreement all work this way.

export interface Dated {
  readonly fromDate: string
  /** The last day it applies, or null until further notice. */
  readonly toDate: string | null
}

export const inForceOn = (row: Dated, date: string) =>
  row.fromDate <= date && (row.toDate === null || row.toDate >= date)

/** Whether the row applies on any day of the period. */
export const overlapsPeriod = (row: Dated, period: { start: string; end: string }) =>
  row.fromDate <= period.end && (row.toDate === null || row.toDate >= period.start)

/** The rows that apply on `date`. */
export const inForce = <R extends Dated>(rows: readonly R[], date: string) =>
  rows.filter((row) => inForceOn(row, date))

/** The last day of a row that is replaced from `date`. */
export const dayBefore = (date: string) => addDays(date, -1)
