import { effectiveEndDate, type LeaseTerms, leaseStatus } from '#/features/leases/terms'
import { addDays } from '#/lib/dates'

// Pure rules for a unit's page: who rents it now, who is next, and when it is free.

export type UnitState = 'vacant' | 'reserved' | 'rented' | 'leaving'

export interface Availability<L> {
  readonly state: UnitState
  /** The lease that runs today. */
  readonly current: L | null
  /** The next lease to start. */
  readonly next: L | null
  /** First free day; null while it is rented with no end, or when the next lease follows on. */
  readonly freeFrom: string | null
}

export function unitAvailability<L extends LeaseTerms>(
  leases: readonly L[],
  today: string,
): Availability<L> {
  const current = leases.find((l) => {
    const status = leaseStatus(l, today)
    return status === 'active' || status === 'terminated'
  })
  const next =
    leases
      .filter((l) => leaseStatus(l, today) === 'upcoming')
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null

  if (!current) {
    return { state: next ? 'reserved' : 'vacant', current: null, next, freeFrom: today }
  }
  const end = effectiveEndDate(current)
  if (!end) return { state: 'rented', current, next, freeFrom: null }
  const dayAfter = addDays(end, 1)
  return {
    state: 'leaving',
    current,
    next,
    freeFrom: next && next.startDate <= dayAfter ? null : dayAfter,
  }
}
