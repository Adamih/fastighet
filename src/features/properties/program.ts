import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { Effect } from 'effect'
import { leaseUnit, property, unit } from '#/db/schema'
import { leaseStatus, occupyingLease } from '#/features/leases/terms'
import type { Permissions } from '#/lib/permissions'
import { blankToNull } from '#/lib/schemas'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { normalizeDesignation } from './designation'
import type {
  CreatePropertyInput,
  CreateUnitInput,
  UpdatePropertyInput,
  UpdateUnitInput,
} from './schemas'

// Properties and their units share one permission.
const read: Permissions = { property: ['read'] }
const manage: Permissions = { property: ['manage'] }

export const listProperties = requirePermission(read).pipe(
  Effect.andThen(
    orgQuery((db, organizationId) =>
      db.query.property.findMany({
        where: eq(property.organizationId, organizationId),
        orderBy: asc(property.designation),
      }),
    ),
  ),
)

export const getProperty = (propertyId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    const found = yield* orgQuery((db, organizationId) =>
      db.query.property.findFirst({
        where: and(eq(property.id, propertyId), eq(property.organizationId, organizationId)),
      }),
    )
    if (!found) return yield* new NotFound({ entity: 'property', id: propertyId })

    const rows = yield* orgQuery((db, organizationId) =>
      db.query.unit.findMany({
        where: and(eq(unit.propertyId, propertyId), eq(unit.organizationId, organizationId)),
        orderBy: asc(unit.label),
        with: {
          leases: {
            with: { lease: { with: { tenant: { columns: { name: true } } } } },
          },
        },
      }),
    )
    const on = yield* today
    // Who occupies each unit comes from the leases, so it is only shown to those who may read them.
    const showOccupancy = yield* hasPermission({ lease: ['read'] })
    const units = rows.map(({ leases, ...u }) => {
      if (!showOccupancy) return { ...u, occupancy: null }
      const occupant = occupyingLease(
        leases.map((l) => l.lease),
        on,
      )
      return {
        ...u,
        occupancy: occupant && {
          leaseId: occupant.lease.id,
          number: occupant.lease.number,
          tenantName: occupant.lease.tenant.name,
          status: occupant.status,
          startDate: occupant.lease.startDate,
          moveOutDate: occupant.lease.moveOutDate,
          rentOre: occupant.lease.rentOre,
          rentInterval: occupant.lease.rentInterval,
          vat: occupant.lease.vat,
        },
      }
    })
    return { ...found, units }
  })

/** Every unit in the company with its property, for pickers such as the lease form. */
export const listUnits = Effect.gen(function* () {
  yield* requirePermission(read)
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.unit.findMany({
      where: eq(unit.organizationId, organizationId),
      with: { property: { columns: { designation: true } } },
    }),
  )
  return rows
    .map((u) => ({ id: u.id, label: u.label, kind: u.kind, designation: u.property.designation }))
    .sort((a, b) => a.designation.localeCompare(b.designation) || a.label.localeCompare(b.label))
})

const normalizeProperty = (input: CreatePropertyInput) => ({
  designation: normalizeDesignation(input.designation),
  name: blankToNull(input.name),
  streetAddress: blankToNull(input.streetAddress),
  postalCode: blankToNull(input.postalCode.replace(/\s/g, '')),
  city: blankToNull(input.city),
})

const ensureUniqueDesignation = (designation: string, exceptId?: string) =>
  Effect.gen(function* () {
    const existing = yield* orgQuery((db, organizationId) =>
      db.query.property.findFirst({
        columns: { id: true },
        where: and(
          eq(property.organizationId, organizationId),
          eq(property.designation, designation),
          exceptId ? ne(property.id, exceptId) : undefined,
        ),
      }),
    )
    if (existing) return yield* new Conflict({ message: `${designation} finns redan` })
  })

export const createProperty = (input: CreatePropertyInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const values = normalizeProperty(input)
    yield* ensureUniqueDesignation(values.designation)
    const [created] = yield* orgQuery((db, organizationId) =>
      db
        .insert(property)
        .values({ organizationId, ...values })
        .returning(),
    )
    return created
  })

export const updateProperty = (input: UpdatePropertyInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getProperty(input.propertyId)
    const values = normalizeProperty(input)
    yield* ensureUniqueDesignation(values.designation, current.id)
    yield* orgQuery((db, organizationId) =>
      db
        .update(property)
        .set(values)
        .where(and(eq(property.id, current.id), eq(property.organizationId, organizationId))),
    )
    return yield* getProperty(current.id)
  })

/** Units that have ever been on a lease (including ended ones) are part of the history. */
const leasedUnitLabels = (unitIds: readonly string[]) =>
  unitIds.length === 0
    ? Effect.succeed([] as string[])
    : orgQuery((db, organizationId) =>
        db
          .selectDistinct({ label: unit.label })
          .from(leaseUnit)
          .innerJoin(unit, eq(unit.id, leaseUnit.unitId))
          .where(
            and(eq(leaseUnit.organizationId, organizationId), inArray(leaseUnit.unitId, unitIds)),
          ),
      ).pipe(Effect.map((rows) => rows.map((r) => r.label).sort()))

/** Deletes the property and its units, unless any unit has ever been leased. */
export const deleteProperty = (propertyId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getProperty(propertyId)
    const leased = yield* leasedUnitLabels(current.units.map((u) => u.id))
    if (leased.length > 0) {
      return yield* new Conflict({
        message: `Fastigheten har avtal på objekt ${leased.join(', ')} och kan inte tas bort.`,
      })
    }
    yield* orgQuery((db, organizationId) =>
      db
        .delete(property)
        .where(and(eq(property.id, current.id), eq(property.organizationId, organizationId))),
    )
  })

export const getUnit = (unitId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    const row = yield* orgQuery((db, organizationId) =>
      db.query.unit.findFirst({
        where: and(eq(unit.id, unitId), eq(unit.organizationId, organizationId)),
        with: { property: { columns: { id: true, designation: true } } },
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'unit', id: unitId })
    const leased = yield* leasedUnitLabels([row.id])
    return { ...row, hasLeases: leased.length > 0 }
  })

/**
 * A unit for its own page: its property and every lease it has been on, newest first. The
 * leases only for those who may read leases.
 */
export const getUnitDetail = (unitId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    const row = yield* orgQuery((db, organizationId) =>
      db.query.unit.findFirst({
        where: and(eq(unit.id, unitId), eq(unit.organizationId, organizationId)),
        with: {
          property: { columns: { id: true, designation: true, name: true } },
          leases: {
            with: {
              lease: { with: { tenant: { columns: { id: true, name: true, kind: true } } } },
            },
          },
        },
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'unit', id: unitId })
    const { leases, ...found } = row
    const on = yield* today
    const showLeases = yield* hasPermission({ lease: ['read'] })
    return {
      ...found,
      hasLeases: leases.length > 0,
      leases: showLeases
        ? leases
            .map(({ lease }) => ({ ...lease, status: leaseStatus(lease, on) }))
            .sort((a, b) => b.startDate.localeCompare(a.startDate))
        : [],
    }
  })

export const updateUnit = (input: UpdateUnitInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getUnit(input.unitId)
    const label = input.label.trim()
    const clash = yield* orgQuery((db, organizationId) =>
      db.query.unit.findFirst({
        columns: { id: true },
        where: and(
          eq(unit.organizationId, organizationId),
          eq(unit.propertyId, current.propertyId),
          eq(unit.label, label),
          ne(unit.id, current.id),
        ),
      }),
    )
    if (clash) return yield* new Conflict({ message: `Objekt ${label} finns redan på fastigheten` })
    yield* orgQuery((db, organizationId) =>
      db
        .update(unit)
        .set({ kind: input.kind, label, areaSqm: input.areaSqm })
        .where(and(eq(unit.id, current.id), eq(unit.organizationId, organizationId))),
    )
    return yield* getUnit(current.id)
  })

export const deleteUnit = (unitId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getUnit(unitId)
    if (current.hasLeases) {
      return yield* new Conflict({
        message: `Objekt ${current.label} har avtal och kan inte tas bort.`,
      })
    }
    yield* orgQuery((db, organizationId) =>
      db.delete(unit).where(and(eq(unit.id, current.id), eq(unit.organizationId, organizationId))),
    )
    return { propertyId: current.propertyId }
  })

export const createUnit = (input: CreateUnitInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    // Confirms the property belongs to the current company before attaching anything to it.
    const parent = yield* getProperty(input.propertyId)
    const label = input.label.trim()
    if (parent.units.some((u) => u.label === label)) {
      return yield* new Conflict({ message: `Objekt ${label} finns redan på fastigheten` })
    }

    const [created] = yield* orgQuery((db, organizationId) =>
      db
        .insert(unit)
        .values({
          organizationId,
          propertyId: parent.id,
          kind: input.kind,
          label,
          areaSqm: input.areaSqm,
        })
        .returning(),
    )
    return created
  })
