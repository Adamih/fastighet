import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { property, unit } from '#/db/schema'
import { occupyingLease } from '#/features/leases/terms'
import { blankToNull } from '#/lib/schemas'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { normalizeDesignation } from './designation'
import type { CreatePropertyInput, CreateUnitInput } from './schemas'

export const listProperties = orgQuery((db, organizationId) =>
  db.query.property.findMany({
    where: eq(property.organizationId, organizationId),
    orderBy: asc(property.designation),
  }),
)

export const getProperty = (propertyId: string) =>
  Effect.gen(function* () {
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
    const units = rows.map(({ leases, ...u }) => {
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
        },
      }
    })
    return { ...found, units }
  })

/** Every unit in the company with its property, for pickers such as the lease form. */
export const listUnits = Effect.gen(function* () {
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

export const createProperty = (input: CreatePropertyInput) =>
  Effect.gen(function* () {
    const designation = normalizeDesignation(input.designation)

    const existing = yield* orgQuery((db, organizationId) =>
      db.query.property.findFirst({
        columns: { id: true },
        where: and(
          eq(property.organizationId, organizationId),
          eq(property.designation, designation),
        ),
      }),
    )
    if (existing) return yield* new Conflict({ message: `${designation} finns redan` })

    const [created] = yield* orgQuery((db, organizationId) =>
      db
        .insert(property)
        .values({
          organizationId,
          designation,
          name: blankToNull(input.name),
          streetAddress: blankToNull(input.streetAddress),
          postalCode: blankToNull(input.postalCode.replace(/\s/g, '')),
          city: blankToNull(input.city),
        })
        .returning(),
    )
    return created
  })

export const createUnit = (input: CreateUnitInput) =>
  Effect.gen(function* () {
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
