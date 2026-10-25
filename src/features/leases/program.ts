import { and, count, desc, eq, inArray, min, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  agreement,
  agreementParty,
  agreementUnit,
  invoice,
  leaseTerms,
  tenant,
  unit,
} from '#/db/schema'
import {
  joinNames,
  leaseParties,
  type PartiesProblem,
  primaryParty,
} from '#/features/agreements/parties'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import type { CreateLeaseInput, TerminateLeaseInput, UpdateLeaseInput } from './schemas'
import { earliestMoveOutDate, effectiveEndDate, leaseStatus, periodsOverlap } from './terms'

// A lease is an agreement of kind `lease` with its `leaseTerms`. The view flattens both, so the
// lease pages see one record: `endDate` is the last billed day, `termEndDate` the fixed term's end.
const withLeaseDetails = {
  leaseTerms: true,
  parties: {
    orderBy: agreementParty.position,
    with: { tenant: { columns: { id: true, name: true, kind: true } } },
  },
  units: { with: { unit: { with: { property: { columns: { id: true, designation: true } } } } } },
} as const

type LeaseRow = typeof agreement.$inferSelect & {
  leaseTerms: typeof leaseTerms.$inferSelect | null
  parties: (typeof agreementParty.$inferSelect & {
    tenant: { id: string; name: string; kind: 'person' | 'company' }
  })[]
  units: {
    unit: typeof unit.$inferSelect & { property: { id: string; designation: string } }
  }[]
}

const toView = ({ leaseTerms: terms, parties, ...row }: LeaseRow, on: string) => {
  if (!terms) throw new Error(`Lease ${row.id} has no lease terms`)
  const { agreementId: _, organizationId: __, ...leaseFields } = terms
  const lease = { ...row, ...leaseFields }
  return {
    ...lease,
    /** The tenant named first; the one the lease pages show. */
    tenant: primaryParty(parties).tenant,
    /** Every tenant's name, as the avier print them. */
    partyNames: joinNames(parties.map((p) => p.tenant.name)),
    parties: parties.map((p) => ({
      ...p.tenant,
      role: p.role,
      receivesInvoices: p.receivesInvoices,
    })),
    units: row.units
      .map(({ unit }) => ({
        id: unit.id,
        label: unit.label,
        kind: unit.kind,
        areaSqm: unit.areaSqm,
        propertyId: unit.property.id,
        designation: unit.property.designation,
      }))
      .sort((a, b) => a.designation.localeCompare(b.designation) || a.label.localeCompare(b.label)),
    status: leaseStatus(lease, on),
  }
}

export type LeaseView = ReturnType<typeof toView>

const read: Permissions = { lease: ['read'] }
const manage: Permissions = { lease: ['manage'] }

export const listLeases = Effect.gen(function* () {
  yield* requirePermission(read)
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findMany({
      where: and(eq(agreement.organizationId, organizationId), eq(agreement.kind, 'lease')),
      orderBy: desc(agreement.number),
      with: withLeaseDetails,
    }),
  )
  const on = yield* today
  return rows.map((row) => toView(row, on))
})

export const getLease = (leaseId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    const row = yield* orgQuery((db, organizationId) =>
      db.query.agreement.findFirst({
        where: and(
          eq(agreement.id, leaseId),
          eq(agreement.organizationId, organizationId),
          eq(agreement.kind, 'lease'),
        ),
        with: withLeaseDetails,
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'lease', id: leaseId })
    const view = toView(row, yield* today)
    // Contact details are tenant data, shown only to those who may read tenants.
    const contacts = (yield* hasPermission({ tenant: ['read'] }))
      ? yield* orgQuery((db, organizationId) =>
          db.query.tenant.findMany({
            columns: { id: true, email: true, phone: true },
            where: and(
              eq(tenant.organizationId, organizationId),
              inArray(
                tenant.id,
                view.parties.map((p) => p.id),
              ),
            ),
          }),
        )
      : []
    const contactOf = (tenantId: string) => {
      const found = contacts.find((c) => c.id === tenantId)
      return found ? { email: found.email, phone: found.phone } : null
    }
    return {
      ...view,
      parties: view.parties.map((p) => ({ ...p, contact: contactOf(p.id) })),
    }
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
    termEndDate: string | null
    extensionMonths: number | null
    moveOutDate: string | null
  },
  exceptLeaseId?: string,
) =>
  Effect.gen(function* () {
    if (terms.termEndDate && terms.termEndDate < terms.startDate) {
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
        with: { agreements: { with: { agreement: true } } },
      }),
    )
    if (units.length !== unitIds.length) {
      return yield* new NotFound({ entity: 'unit', id: unitIds.join(',') })
    }

    // Any agreement on the unit counts, whatever its kind; its `endDate` is its last day.
    const period = { start: terms.startDate, end: effectiveEndDate(terms) }
    for (const u of units) {
      for (const { agreement: other } of u.agreements) {
        if (other.id === exceptLeaseId) continue
        if (periodsOverlap(period, { start: other.startDate, end: other.endDate })) {
          return yield* new Conflict({
            message: `Objekt ${u.label} är redan uthyrt under perioden (avtal ${other.number})`,
          })
        }
      }
    }
    return unitIds
  })

const partiesProblemMessages: Record<PartiesProblem, string> = {
  duplicate: 'Samma hyresgäst är vald flera gånger',
  too_many: 'Ett avtal kan ha högst sex hyresgäster',
  receiver: 'Välj vem som ska få avierna bland avtalets hyresgäster',
}

/** The lease's party rows, after checking that every co-tenant belongs to the company. */
const checkParties = (
  tenantId: string,
  input: { coTenantIds: readonly string[]; invoiceRecipientId: string | null },
) =>
  Effect.gen(function* () {
    const result = leaseParties(tenantId, input.coTenantIds, input.invoiceRecipientId)
    if (!result.ok) return yield* new Conflict({ message: partiesProblemMessages[result.problem] })
    if (input.coTenantIds.length > 0) {
      const found = yield* orgQuery((db, organizationId) =>
        db
          .select({ id: tenant.id })
          .from(tenant)
          .where(
            and(
              eq(tenant.organizationId, organizationId),
              inArray(tenant.id, [...input.coTenantIds]),
            ),
          ),
      )
      if (found.length !== input.coTenantIds.length) {
        return yield* new NotFound({ entity: 'tenant', id: input.coTenantIds.join(',') })
      }
    }
    return result.parties
  })

export const createLease = (input: CreateLeaseInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const extensionMonths = input.termEndDate ? input.extensionMonths : null

    const owner = yield* orgQuery((db, organizationId) =>
      db.query.tenant.findFirst({
        columns: { id: true },
        where: and(eq(tenant.id, input.tenantId), eq(tenant.organizationId, organizationId)),
      }),
    )
    if (!owner) return yield* new NotFound({ entity: 'tenant', id: input.tenantId })

    const unitIds = yield* checkLeaseTerms({ ...input, extensionMonths, moveOutDate: null })
    const parties = yield* checkParties(owner.id, input)

    const leaseId = crypto.randomUUID()
    yield* orgQuery((db, organizationId) =>
      // D1 batches run as one transaction. The subquery numbers the lease in the same statement.
      db.batch([
        db.insert(agreement).values({
          id: leaseId,
          organizationId,
          number: sql`(select coalesce(max(${agreement.number}), 0) + 1 from ${agreement} where ${agreement.organizationId} = ${organizationId})`,
          kind: 'lease',
          startDate: input.startDate,
          endDate: effectiveEndDate({
            termEndDate: input.termEndDate,
            extensionMonths,
            moveOutDate: null,
          }),
          rentOre: input.rentOre,
          rentInterval: input.rentInterval,
          invoiceInterval: input.invoiceInterval,
          vat: input.vat,
        }),
        db.insert(leaseTerms).values({
          agreementId: leaseId,
          organizationId,
          termEndDate: input.termEndDate,
          extensionMonths,
          noticePeriodMonths: input.noticePeriodMonths,
        }),
        db
          .insert(agreementParty)
          .values(parties.map((p) => ({ ...p, agreementId: leaseId, organizationId }))),
        db
          .insert(agreementUnit)
          .values(unitIds.map((unitId) => ({ agreementId: leaseId, unitId, organizationId }))),
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
      .where(and(eq(invoice.organizationId, organizationId), eq(invoice.agreementId, leaseId))),
  ).pipe(
    Effect.map(([row]) => ({
      total: row?.total ?? 0,
      firstActivePeriod: (row?.firstActivePeriod as string | null) ?? null,
    })),
  )

/**
 * Changes the lease's units, co-tenants, dates and rent. The tenant stays: a new tenant is a new
 * lease.
 * Issued invoices are not touched, so the new terms only affect future invoice runs.
 */
export const updateLease = (input: UpdateLeaseInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getLease(input.leaseId)
    const extensionMonths = input.termEndDate ? input.extensionMonths : null

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
    const parties = yield* checkParties(current.tenant.id, input)

    yield* orgQuery((db, organizationId) =>
      db.batch([
        db
          .update(agreement)
          .set({
            startDate: input.startDate,
            endDate: effectiveEndDate({
              termEndDate: input.termEndDate,
              extensionMonths,
              moveOutDate: current.moveOutDate,
            }),
            rentOre: input.rentOre,
            rentInterval: input.rentInterval,
            invoiceInterval: input.invoiceInterval,
            vat: input.vat,
          })
          .where(and(eq(agreement.id, current.id), eq(agreement.organizationId, organizationId))),
        db
          .update(leaseTerms)
          .set({
            termEndDate: input.termEndDate,
            extensionMonths,
            noticePeriodMonths: input.noticePeriodMonths,
          })
          .where(
            and(
              eq(leaseTerms.agreementId, current.id),
              eq(leaseTerms.organizationId, organizationId),
            ),
          ),
        db
          .delete(agreementParty)
          .where(
            and(
              eq(agreementParty.agreementId, current.id),
              eq(agreementParty.organizationId, organizationId),
            ),
          ),
        db
          .insert(agreementParty)
          .values(parties.map((p) => ({ ...p, agreementId: current.id, organizationId }))),
        db
          .delete(agreementUnit)
          .where(
            and(
              eq(agreementUnit.agreementId, current.id),
              eq(agreementUnit.organizationId, organizationId),
            ),
          ),
        db
          .insert(agreementUnit)
          .values(unitIds.map((unitId) => ({ agreementId: current.id, unitId, organizationId }))),
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
      db.batch([
        db
          .update(leaseTerms)
          .set({ noticeDate: input.noticeDate, moveOutDate })
          .where(
            and(
              eq(leaseTerms.agreementId, current.id),
              eq(leaseTerms.organizationId, organizationId),
            ),
          ),
        db
          .update(agreement)
          .set({ endDate: moveOutDate })
          .where(and(eq(agreement.id, current.id), eq(agreement.organizationId, organizationId))),
      ]),
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
      db.batch([
        db
          .update(leaseTerms)
          .set({ noticeDate: null, moveOutDate: null })
          .where(
            and(
              eq(leaseTerms.agreementId, current.id),
              eq(leaseTerms.organizationId, organizationId),
              // Guards against a concurrent change between the read above and this write.
              eq(leaseTerms.moveOutDate, current.moveOutDate as string),
            ),
          ),
        db
          .update(agreement)
          .set({ endDate: effectiveEndDate({ ...current, moveOutDate: null }) })
          .where(
            and(
              eq(agreement.id, current.id),
              eq(agreement.organizationId, organizationId),
              eq(agreement.endDate, current.moveOutDate as string),
            ),
          ),
      ]),
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
        .delete(agreement)
        .where(and(eq(agreement.id, current.id), eq(agreement.organizationId, organizationId))),
    )
    return { tenantId: current.tenant.id }
  })
