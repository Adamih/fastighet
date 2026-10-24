import { unitLabel } from '#/features/leases/overview'
import type { LeaseStatus } from '#/features/leases/terms'
import type { UnitKind } from '#/features/properties/unit-kinds'
import { m } from '#/paraglide/messages'

// Pure presentation rules for the tenant list: the count line, the lease column and search. Shared by the desktop table and the phone list.

/** "3 privatpersoner · 1 företag" */
export function tenantCountLine(tenants: readonly { kind: 'person' | 'company' }[]): string {
  const people = tenants.filter((t) => t.kind === 'person').length
  const companies = tenants.length - people
  return [
    people > 0 && m.tenant_count_people({ count: people }),
    companies > 0 && m.tenant_count_companies({ count: companies }),
  ]
    .filter(Boolean)
    .join(' · ')
}

interface TenantLease {
  readonly number: number
  readonly status: LeaseStatus
  readonly units: readonly { kind: UnitKind; label: string }[]
}

/**
 * The tenant's current leases: "#1 · Lgh 1001", "#2 · Lokal 2001, P-plats P1". Ended leases
 * show only when there is nothing else. Null when the tenant has no lease.
 */
export function leaseLine(leases: readonly TenantLease[]): string | null {
  const current = leases.filter((l) => l.status !== 'ended')
  const shown = current.length > 0 ? current : leases.slice(0, 1)
  if (shown.length === 0) return null
  return shown
    .map((l) =>
      [`#${l.number}`, l.units.map(unitLabel).sort().join(', ')].filter(Boolean).join(' · '),
    )
    .join('; ')
}

/** Whether a search matches the tenant's name, email or organisationsnummer. */
export function matchesTenant(
  tenant: { name: string; email: string | null; organizationNumber: string | null },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const digits = needle.replace(/\D/g, '')
  return (
    tenant.name.toLowerCase().includes(needle) ||
    (tenant.email?.toLowerCase().includes(needle) ?? false) ||
    (digits.length > 0 && (tenant.organizationNumber?.replace(/\D/g, '').includes(digits) ?? false))
  )
}
