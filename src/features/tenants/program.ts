import { and, asc, desc, eq, ne } from 'drizzle-orm'
import { Effect } from 'effect'
import { lease, tenant } from '#/db/schema'
import { leaseStatus } from '#/features/leases/terms'
import type { Permissions } from '#/lib/permissions'
import { blankToNull } from '#/lib/schemas'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { formatOrganizationNumber } from './organization-number'
import type { CreateTenantInput, UpdateTenantInput } from './schemas'

const read: Permissions = { tenant: ['read'] }
const manage: Permissions = { tenant: ['manage'] }

/** Tenants by name, each with their leases (newest first) for those who may read leases and units. */
export const listTenants = Effect.gen(function* () {
  yield* requirePermission(read)
  const showLeases = yield* hasPermission({ lease: ['read'], property: ['read'] })
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.tenant.findMany({
      where: eq(tenant.organizationId, organizationId),
      orderBy: asc(tenant.name),
      with: {
        leases: {
          orderBy: desc(lease.number),
          with: { units: { with: { unit: { columns: { kind: true, label: true } } } } },
        },
      },
    }),
  )
  const on = yield* today
  return rows.map(({ leases, ...row }) => ({
    ...row,
    leases: showLeases
      ? leases.map((l) => ({
          id: l.id,
          number: l.number,
          status: leaseStatus(l, on),
          units: l.units.map(({ unit }) => unit),
        }))
      : [],
  }))
})

/** The tenant with all their leases, for the checks below. No permission check of its own. */
const loadTenant = (tenantId: string) =>
  Effect.gen(function* () {
    const row = yield* orgQuery((db, organizationId) =>
      db.query.tenant.findFirst({
        where: and(eq(tenant.id, tenantId), eq(tenant.organizationId, organizationId)),
        with: { leases: { orderBy: desc(lease.number) } },
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'tenant', id: tenantId })
    const on = yield* today
    return {
      ...row,
      leases: row.leases.map((l) => ({ ...l, status: leaseStatus(l, on) })),
    }
  })

/** The tenant with their leases, newest first; the leases only for those who may read leases. */
export const getTenant = (tenantId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    const found = yield* loadTenant(tenantId)
    const showLeases = yield* hasPermission({ lease: ['read'] })
    return { ...found, leases: showLeases ? found.leases : [] }
  })

const normalize = (input: CreateTenantInput) => ({
  kind: input.kind,
  name: input.name.trim(),
  organizationNumber:
    input.kind === 'company' && input.organizationNumber.trim()
      ? formatOrganizationNumber(input.organizationNumber)
      : null,
  email: blankToNull(input.email),
  phone: blankToNull(input.phone),
  streetAddress: blankToNull(input.streetAddress),
  postalCode: blankToNull(input.postalCode.replace(/\s/g, '')),
  city: blankToNull(input.city),
})

/** Fails if another tenant in the company already has this organisationsnummer. */
const ensureUniqueOrganizationNumber = (organizationNumber: string | null, exceptId?: string) =>
  Effect.gen(function* () {
    if (!organizationNumber) return
    const existing = yield* orgQuery((db, organizationId) =>
      db.query.tenant.findFirst({
        columns: { name: true },
        where: and(
          eq(tenant.organizationId, organizationId),
          eq(tenant.organizationNumber, organizationNumber),
          exceptId ? ne(tenant.id, exceptId) : undefined,
        ),
      }),
    )
    if (existing) {
      return yield* new Conflict({
        message: `${existing.name} har redan organisationsnummer ${organizationNumber}`,
      })
    }
  })

export const createTenant = (input: CreateTenantInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const values = normalize(input)
    yield* ensureUniqueOrganizationNumber(values.organizationNumber)
    const [created] = yield* orgQuery((db, organizationId) =>
      db
        .insert(tenant)
        .values({ organizationId, ...values })
        .returning(),
    )
    return created
  })

/** Issued invoices keep the recipient details they were created with. */
export const updateTenant = (input: UpdateTenantInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* loadTenant(input.tenantId)
    const values = normalize(input)
    yield* ensureUniqueOrganizationNumber(values.organizationNumber, current.id)
    yield* orgQuery((db, organizationId) =>
      db
        .update(tenant)
        .set(values)
        .where(and(eq(tenant.id, current.id), eq(tenant.organizationId, organizationId))),
    )
    return yield* getTenant(current.id)
  })

export const deleteTenant = (tenantId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* loadTenant(tenantId)
    if (current.leases.length > 0) {
      return yield* new Conflict({
        message: `${current.name} har avtal och kan inte tas bort. Ta bort avtalen först.`,
      })
    }
    yield* orgQuery((db, organizationId) =>
      db
        .delete(tenant)
        .where(and(eq(tenant.id, current.id), eq(tenant.organizationId, organizationId))),
    )
  })
