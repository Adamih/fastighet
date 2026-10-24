import type { RentInterval } from '#/features/leases/options'
import { monthlyRentOre } from '#/features/leases/overview'
import type { LeaseStatus } from '#/features/leases/terms'

// Pure rules for the property page's key figures.

interface SummaryUnit {
  readonly areaSqm: number | null
  readonly occupancy: {
    readonly leaseId: string
    readonly status: LeaseStatus
    readonly rentOre: number
    readonly rentInterval: RentInterval
    readonly vat: boolean
  } | null
}

/** Units, how many are rented today, their monthly rent and total area. */
export function propertySummary(units: readonly SummaryUnit[]) {
  const rented = units.filter(
    (u) => u.occupancy?.status === 'active' || u.occupancy?.status === 'terminated',
  )
  // A lease covering several units here is counted once.
  const leases = new Map(rented.map((u) => [u.occupancy?.leaseId, u.occupancy]))
  const running = [...leases.values()].filter((l) => l !== null && l !== undefined)
  return {
    units: units.length,
    rented: rented.length,
    monthlyRentOre: running.reduce((sum, l) => sum + monthlyRentOre(l), 0),
    vat: running.some((l) => l.vat),
    areaSqm: units.reduce((sum, u) => sum + (u.areaSqm ?? 0), 0),
  }
}
