// Pure rules for pledges (pantsättningar) of bostadsrätter. Shared by the server (checks) and the
// UI (previews and lists).

export interface PledgeDates {
  readonly notifiedOn: string
  readonly releasedOn: string | null
}

/** In force on `date`: notified by then and not yet released (a release takes effect that day). */
export const activeOn = (pledge: PledgeDates, date: string) =>
  pledge.notifiedOn <= date && (pledge.releasedOn === null || date < pledge.releasedOn)

/**
 * Pledges in priority order (the earliest notice first; same-day notices in the order they were
 * registered), each active one numbered from 1. Released pledges keep no priority and come last,
 * the most recently released first.
 */
export function inPriorityOrder<P extends PledgeDates & { readonly createdAt: number }>(
  pledges: readonly P[],
  today: string,
): (P & { readonly active: boolean; readonly priority: number | null })[] {
  const byNotice = (a: P, b: P) =>
    a.notifiedOn.localeCompare(b.notifiedOn) || a.createdAt - b.createdAt
  const active = pledges.filter((p) => activeOn(p, today)).sort(byNotice)
  const rest = pledges
    .filter((p) => !activeOn(p, today))
    .sort((a, b) => (b.releasedOn ?? '').localeCompare(a.releasedOn ?? '') || byNotice(a, b))
  return [
    ...active.map((p, i) => ({ ...p, active: true, priority: i + 1 })),
    ...rest.map((p) => ({ ...p, active: false, priority: null })),
  ]
}

export type RegisterProblem = 'future' | 'ended'

/**
 * Why a notice from `notifiedOn` can't be registered on the bostadsrätt, or null. A notice may
 * arrive before the owners' first day (a buyer's bank often notifies before tillträde), but not
 * after the right has been transferred away.
 */
export function registerProblem(
  ownership: { readonly endDate: string | null },
  notifiedOn: string,
  today: string,
): RegisterProblem | null {
  if (notifiedOn > today) return 'future'
  if (ownership.endDate !== null && notifiedOn > ownership.endDate) return 'ended'
  return null
}

export type ReleaseProblem = 'released' | 'before_notice' | 'future'

/** Why the pledge can't be released on `releasedOn`, or null. */
export function releaseProblem(
  pledge: PledgeDates,
  releasedOn: string,
  today: string,
): ReleaseProblem | null {
  if (pledge.releasedOn !== null) return 'released'
  if (releasedOn > today) return 'future'
  if (releasedOn < pledge.notifiedOn) return 'before_notice'
  return null
}
