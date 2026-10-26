import type { ChargeInterval } from '#/features/agreements/kinds'
import type { UnitKind } from '#/features/properties/unit-kinds'
import { addDays, addMonths } from '#/lib/dates'

// Pure rules for index clauses (indexklausul) and the yearly indexation (indexuppräkning),
// following Fastighetsägarna's standard clause for commercial leases. Client-safe, unit-tested.
//
// KPI values are integers: the index times 100 (1980=100), so 419.35 is 41935.

export type ClauseProblem = 'residential' | 'not_fixed_term' | 'too_short'

/**
 * Why a lease can't have an index clause, or null. Rent must normally be a fixed amount; an index
 * clause is only valid in a lease of premises for a fixed term of at least three years
 * (12 kap. 19 § jordabalken). Residential rent can't follow an index outside a collective
 * agreement, so a lease that includes an apartment can't have one.
 */
export function clauseProblem(lease: {
  readonly unitKinds: readonly UnitKind[]
  readonly startDate: string
  readonly termEndDate: string | null
}): ClauseProblem | null {
  if (lease.unitKinds.includes('apartment')) return 'residential'
  if (lease.termEndDate === null) return 'not_fixed_term'
  if (lease.termEndDate < addDays(addMonths(lease.startDate, 36), -1)) return 'too_short'
  return null
}

const month = (date: string) => date.slice(0, 7)

/** The usual base month: October of the year before the lease starts, "2025-10". */
export const defaultBaseMonth = (startDate: string) => `${Number(startDate.slice(0, 4)) - 1}-10`

/** The day the rent is adjusted in `year`: the first of the clause's adjustment month. */
export const adjustmentDate = (year: number, adjustmentMonth: number) =>
  `${year}-${String(adjustmentMonth).padStart(2, '0')}-01`

/** The KPI month an adjustment uses: three months before it (October for 1 January). */
export const kpiMonthFor = (effectiveDate: string) => month(addMonths(effectiveDate, -3))

/** "oktober 2026" */
export const monthLabel = (yyyyMm: string) =>
  new Date(`${yyyyMm}-01T12:00:00Z`).toLocaleString('sv-SE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** "419,35" */
export const formatKpi = (hundredths: number) =>
  (hundredths / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })

/** A charge's amount per year. */
export const perYear = (amountOre: number, interval: ChargeInterval) =>
  interval === 'monthly' ? amountOre * 12 : amountOre

/**
 * The index supplement per year (indextillägg): base rent × indexed share × (KPI − base KPI) /
 * base KPI, rounded to whole kronor as is customary. With `floorAtBase` the rent never goes
 * below the base rent, so the supplement is never negative.
 */
export function indexSupplement(input: {
  readonly baseRentPerYearOre: number
  readonly sharePercent: number
  readonly baseKpi: number
  readonly kpi: number
  readonly floorAtBase: boolean
}): number {
  const { baseRentPerYearOre, sharePercent, baseKpi, kpi, floorAtBase } = input
  // Integers throughout: rent in öre × percent × KPI hundredths stays well within 2^53.
  const exact = (baseRentPerYearOre * sharePercent * (kpi - baseKpi)) / (100 * baseKpi)
  const kronor = Math.round(exact / 100) * 100
  const result = floorAtBase ? Math.max(0, kronor) : kronor
  return result === 0 ? 0 : result
}
