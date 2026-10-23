import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { lease, leaseUnit, tenant, unit } from '#/db/schema'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import type { CreateLeaseInput, TerminateLeaseInput } from './schemas'
import { earliestMoveOutDate, effectiveEndDate, leaseStatus, periodsOverlap } from './terms'

const withTenantAndUnits = {
  tenant: { columns: { id: true, name: true, kind: true } },
  units: { with: { unit: { with: { property: { columns: { id: true, designation: true } } } } } },
} as const

type LeaseRow = typeof lease.$inferSelect & {
  tenant: { id: string; name: string; kind: 'person' | 'company' }
  units: {
    unit: typeof unit.$inferSelect & { property: { id: string; designation: string } }
  }[]
}

const toView = (row: LeaseRow, on: string) => ({
  ...row,
  units: row.units
    .map(({ unit }) => ({
      id: unit.id,
      label: unit.label,
      kind: unit.kind,
      propertyId: unit.property.id,
      designation: unit.property.designation,
    }))
    .sort((a, b) => a.designation.localeCompare(b.designation) || a.label.localeCompare(b.label)),
  status: leaseStatus(row, on),
})

export type LeaseView = ReturnType<typeof toView>

export const listLeases = Effect.gen(function* () {
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.lease.findMany({
      where: eq(lease.organizationId, organizationId),
      orderBy: desc(lease.number),
      with: withTenantAndUnits,
    }),
  )
  const on = yield* today
  return rows.map((row) => toView(row, on))
})

export const getLease = (leaseId: string) =>
  Effect.gen(function* () {
    const row = yield* orgQuery((db, organizationId) =>
      db.query.lease.findFirst({
        where: and(eq(lease.id, leaseId), eq(lease.organizationId, organizationId)),
        with: withTenantAndUnits,
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'lease', id: leaseId })
    return toView(row, yield* today)
  })

export const createLease = (input: CreateLeaseInput) =>
  Effect.gen(function* () {
    if (input.endDate && input.endDate < input.startDate) {
      return yield* new Conflict({ message: 'Slutdatum kan inte vara före startdatum' })
    }
    const extensionMonths = input.endDate ? input.extensionMonths : null

    const owner = yield* orgQuery((db, organizationId) =>
      db.query.tenant.findFirst({
        columns: { id: true },
        where: and(eq(tenant.id, input.tenantId), eq(tenant.organizationId, organizationId)),
      }),
    )
    if (!owner) return yield* new NotFound({ entity: 'tenant', id: input.tenantId })

    const unitIds = [...new Set(input.unitIds)]
    const units = yield* orgQuery((db, organizationId) =>
      db.query.unit.findMany({
        columns: { id: true, label: true },
        where: and(eq(unit.organizationId, organizationId), inArray(unit.id, unitIds)),
        with: { leases: { with: { lease: true } } },
      }),
    )
    if (units.length !== unitIds.length) {
      return yield* new NotFound({ entity: 'unit', id: unitIds.join(',') })
    }

    // Not atomic with the insert below; acceptable while each company has a handful of users.
    const period = {
      start: input.startDate,
      end: effectiveEndDate({ ...input, extensionMonths, moveOutDate: null }),
    }
    for (const u of units) {
      for (const { lease: other } of u.leases) {
        if (periodsOverlap(period, { start: other.startDate, end: effectiveEndDate(other) })) {
          return yield* new Conflict({
            message: `Objekt ${u.label} är redan uthyrt under perioden (avtal ${other.number})`,
          })
        }
      }
    }

    const leaseId = crypto.randomUUID()
    yield* orgQuery((db, organizationId) =>
      // D1 batches run as one transaction. The subquery numbers the lease in the same statement.
      db.batch([
        db.insert(lease).values({
          id: leaseId,
          organizationId,
          number: sql`(select coalesce(max(${lease.number}), 0) + 1 from ${lease} where ${lease.organizationId} = ${organizationId})`,
          tenantId: owner.id,
          startDate: input.startDate,
          endDate: input.endDate,
          extensionMonths,
          noticePeriodMonths: input.noticePeriodMonths,
          rentOre: input.rentOre,
          rentInterval: input.rentInterval,
          invoiceInterval: input.invoiceInterval,
          vat: input.vat,
        }),
        db.insert(leaseUnit).values(unitIds.map((unitId) => ({ leaseId, unitId, organizationId }))),
      ]),
    )
    return yield* getLease(leaseId)
  })

export const terminateLease = (input: TerminateLeaseInput) =>
  Effect.gen(function* () {
    const current = yield* getLease(input.leaseId)
    if (current.moveOutDate) {
      return yield* new Conflict({
        message: `Avtalet är redan uppsagt till ${current.moveOutDate}`,
      })
    }
    if (current.status === 'ended') {
      return yield* new Conflict({ message: 'Avtalet har redan löpt ut' })
    }

    const moveOutDate = input.moveOutDate ?? earliestMoveOutDate(current, input.noticeDate)
    if (moveOutDate < input.noticeDate) {
      return yield* new Conflict({ message: 'Avflyttning kan inte vara före uppsägningen' })
    }
    if (moveOutDate < current.startDate) {
      return yield* new Conflict({ message: 'Avflyttning kan inte vara före avtalets start' })
    }

    yield* orgQuery((db, organizationId) =>
      db
        .update(lease)
        .set({ noticeDate: input.noticeDate, moveOutDate })
        .where(and(eq(lease.id, current.id), eq(lease.organizationId, organizationId))),
    )
    return yield* getLease(current.id)
  })
