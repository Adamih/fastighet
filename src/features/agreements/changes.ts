import { type Dated, dayBefore } from './periods'

// Pure rule for changing an agreement's parties or units from a date. Shared by the server
// (which writes the plan) and tests.

export interface PlannedRow<K extends string> extends Dated {
  readonly id: string
  readonly key: K
}

export type ChangePlanProblem = 'too_early' | 'after_end' | 'no_change'

/**
 * What changes from `fromDate` when the open rows (no end) should become `next` (by key, e.g.
 * party id plus role): rows still wanted are kept; rows no longer wanted end the day before, or
 * are removed if they would only have started on or after that day; wanted keys without an open
 * row are added from `fromDate`.
 */
export function planChange<K extends string>(
  rows: readonly PlannedRow<K>[],
  next: readonly K[],
  fromDate: string,
) {
  const open = rows.filter((r) => r.toDate === null)
  const wanted = new Set(next)
  const keep = open.filter((r) => wanted.has(r.key))
  const leaving = open.filter((r) => !wanted.has(r.key))
  const kept = new Set(keep.map((r) => r.key))
  return {
    keep: keep.map((r) => r.id),
    end: leaving
      .filter((r) => r.fromDate < fromDate)
      .map((r) => ({ id: r.id, toDate: dayBefore(fromDate) })),
    remove: leaving.filter((r) => r.fromDate >= fromDate).map((r) => r.id),
    add: next.filter((key) => !kept.has(key)),
  }
}

/** Why the agreement's terms can't change from `fromDate`, or null. */
export function changeDateProblem(
  agreement: { startDate: string; endDate: string | null },
  fromDate: string,
  plan: { end: readonly unknown[]; remove: readonly unknown[]; add: readonly unknown[] },
): ChangePlanProblem | null {
  if (fromDate <= agreement.startDate) return 'too_early'
  if (agreement.endDate && fromDate > agreement.endDate) return 'after_end'
  if (plan.end.length + plan.remove.length + plan.add.length === 0) return 'no_change'
  return null
}
