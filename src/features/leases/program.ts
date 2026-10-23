import { and, count, desc, eq, inArray, min, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { invoice, lease, leaseUnit, tenant, unit } from '#/db/schema'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import type { CreateLeaseInput, TerminateLeaseInput, UpdateLeaseInput } from './schemas'
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

const read: Permissions = { lease: ['read'] }
const manage: Permissions = { lease: ['manage'] }

export const listLeases = Effect.gen(function* () {
  yield* requirePermission(read)
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
    yield* requirePermission(read)
    const row = yield* orgQuery((db, organizationId) =>
      db.query.lease.findFirst({
        where: and(eq(lease.id, leaseId), eq(lease.organizationId, organizationId)),
        with: withTenantAndUnits,
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'lease', id: leaseId })
    return toView(row, yield* today)
  })

/**
 * Validates the parts of a lease that depend on other data: the dates, that every unit belongs
 * to the company, and that no unit is leased by another lease during the period. `exceptLeaseId`
 * leaves the lease being edited out of the overlap check. Returns the de-duplicated unit ids.
 *
 * Not atomic with the write that follows; acceptable while each company has a handful of users.
 */
const checkLeaseTerms = (
  terms: {
    unitIds: readonly string[]
    startDate: string
    endDate: string | null
    extensionMonths: number | null
    moveOutDate: string | null
  },
  exceptLeaseId?: string,
) =>
  Effect.gen(function* () {
    if (terms.endDate && terms.endDate < terms.startDate) {
      return yield* new Conflict({ message: 'Slutdatum kan inte vara före startdatum' })
    }
    if (terms.moveOutDate && terms.moveOutDate < terms.startDate) {
      return yield* new Conflict({
        message: `Avtalet är uppsagt till ${terms.moveOutDate} och kan inte börja senare än så`,
      })
    }

    const unitIds = [...new Set(terms.unitIds)]
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

    const period = {
      start: terms.startDate,
      end: effectiveEndDate({ ...terms, noticePeriodMonths: 0 }),
    }
    for (const u of units) {
      for (const { lease: other } of u.leases) {
        if (other.id === exceptLeaseId) continue
        if (periodsOverlap(period, { start: other.startDate, end: effectiveEndDate(other) })) {
          return yield* new Conflict({
            message: `Objekt ${u.label} är redan uthyrt under perioden (avtal ${other.number})`,
          })
        }
      }
    }
    return unitIds
  })

export const createLease = (input: CreateLeaseInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const extensionMonths = input.endDate ? input.extensionMonths : null

    const owner = yield* orgQuery((db, organizationId) =>
      db.query.tenant.findFirst({
        columns: { id: true },
        where: and(eq(tenant.id, input.tenantId), eq(tenant.organizationId, organizationId)),
      }),
    )
    if (!owner) return yield* new NotFound({ entity: 'tenant', id: input.tenantId })

    const unitIds = yield* checkLeaseTerms({ ...input, extensionMonths, moveOutDate: null })

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

/** Invoices on the lease: how many exist at all, and the first period that was invoiced. */
const invoiceHistory = (leaseId: string) =>
  orgQuery((db, organizationId) =>
    db
      .select({
        total: count(),
        firstActivePeriod: min(
          sql`case when ${invoice.voidedAt} is null then ${invoice.periodStart} end`,
        ),
      })
      .from(invoice)
      .where(and(eq(invoice.organizationId, organizationId), eq(invoice.leaseId, leaseId))),
  ).pipe(
    Effect.map(([row]) => ({
      total: row?.total ?? 0,
      firstActivePeriod: (row?.firstActivePeriod as string | null) ?? null,
    })),
  )

/**
 * Changes the lease's units, dates and rent. The tenant stays: a new tenant is a new lease.
 * Issued invoices are not touched, so the new terms only affect future invoice runs.
 */
export const updateLease = (input: UpdateLeaseInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getLease(input.leaseId)
    const extensionMonths = input.endDate ? input.extensionMonths : null

    const history = yield* invoiceHistory(current.id)
    if (history.firstActivePeriod && input.startDate > history.firstActivePeriod) {
      return yield* new Conflict({
        message: `Avtalet är aviserat från ${history.firstActivePeriod} och kan inte börja senare än så`,
      })
    }

    const unitIds = yield* checkLeaseTerms(
      { ...input, extensionMonths, moveOutDate: current.moveOutDate },
      current.id,
    )

    yield* orgQuery((db, organizationId) =>
      db.batch([
        db
          .update(lease)
          .set({
            startDate: input.startDate,
            endDate: input.endDate,
            extensionMonths,
            noticePeriodMonths: input.noticePeriodMonths,
            rentOre: input.rentOre,
            rentInterval: input.rentInterval,
            invoiceInterval: input.invoiceInterval,
            vat: input.vat,
          })
          .where(and(eq(lease.id, current.id), eq(lease.organizationId, organizationId))),
        db
          .delete(leaseUnit)
          .where(
            and(eq(leaseUnit.leaseId, current.id), eq(leaseUnit.organizationId, organizationId)),
          ),
        db
          .insert(leaseUnit)
          .values(unitIds.map((unitId) => ({ leaseId: current.id, unitId, organizationId }))),
      ]),
    )
    return yield* getLease(current.id)
  })

export const terminateLease = (input: TerminateLeaseInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
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

/**
 * Undoes a termination before the move-out date has passed. Fails if one of the units has been
 * leased to someone else after the move-out, since the lease would then overlap it.
 */
export const withdrawTermination = (leaseId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getLease(leaseId)
    if (!current.moveOutDate) return yield* new Conflict({ message: 'Avtalet är inte uppsagt' })
    if (current.status === 'ended') {
      return yield* new Conflict({ message: 'Avflyttningsdagen har passerat' })
    }

    yield* checkLeaseTerms(
      { ...current, unitIds: current.units.map((u) => u.id), moveOutDate: null },
      current.id,
    )
    yield* orgQuery((db, organizationId) =>
      db
        .update(lease)
        .set({ noticeDate: null, moveOutDate: null })
        .where(
          and(
            eq(lease.id, current.id),
            eq(lease.organizationId, organizationId),
            // Guards against a concurrent change between the read above and this write.
            eq(lease.moveOutDate, current.moveOutDate as string),
          ),
        ),
    )
    return yield* getLease(current.id)
  })

/** Leases that were ever invoiced are accounting history; terminate them instead. */
export const deleteLease = (leaseId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getLease(leaseId)
    const history = yield* invoiceHistory(current.id)
    if (history.total > 0) {
      return yield* new Conflict({
        message: 'Avtalet har avier och kan inte tas bort. Säg upp det i stället.',
      })
    }
    yield* orgQuery((db, organizationId) =>
      db
        .delete(lease)
        .where(and(eq(lease.id, current.id), eq(lease.organizationId, organizationId))),
    )
    return { tenantId: current.tenant.id }
  })
