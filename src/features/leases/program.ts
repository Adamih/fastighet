import { type AnyColumn, desc, eq, inArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  agreement,
  agreementParty,
  agreementUnit,
  charge,
  type indexClause,
  leaseTerms,
  party,
  unit,
} from '#/db/schema'
import {
  type ChangePlanProblem,
  changeDateProblem,
  planChange,
} from '#/features/agreements/changes'
import { currentTerms, shownRows } from '#/features/agreements/current'
import {
  joinNames,
  leaseParties,
  type PartiesProblem,
  primaryParty,
} from '#/features/agreements/parties'
import {
  billedOnceChargeIds,
  checkPartiesExist,
  checkUnitsFree,
  correctBaseCharge,
  correctOpenTerms,
  invoiceHistory,
} from '#/features/agreements/program'
import { requireFeature } from '#/features/billing/program'
import { checkClauseAllows, indexAdjustments } from '#/features/indexation/program'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { today } from '#/server/today'
import type {
  ChangeLeaseFromInput,
  CreateLeaseInput,
  TerminateLeaseInput,
  UpdateLeaseInput,
} from './schemas'
import { earliestMoveOutDate, effectiveEndDate, leaseStatus } from './terms'

// A lease is an agreement of kind `lease` with its `leaseTerms`. The view flattens both, so the
// lease pages see one record: `endDate` is the last billed day, `termEndDate` the fixed term's end.
const withLeaseDetails = {
  leaseTerms: true,
  parties: {
    orderBy: agreementParty.position,
    with: { party: { columns: { id: true, name: true, kind: true } } },
  },
  units: { with: { unit: { with: { property: { columns: { id: true, designation: true } } } } } },
  charges: true,
  indexClause: true,
} as const

type LeaseRow = typeof agreement.$inferSelect & {
  charges: (typeof charge.$inferSelect)[]
  indexClause: typeof indexClause.$inferSelect | null
  leaseTerms: typeof leaseTerms.$inferSelect | null
  parties: (typeof agreementParty.$inferSelect & {
    party: { id: string; name: string; kind: 'person' | 'company' }
  })[]
  units: (typeof agreementUnit.$inferSelect & {
    unit: typeof unit.$inferSelect & { property: { id: string; designation: string } }
  })[]
}

const toView = (
  {
    leaseTerms: terms,
    parties: partyRows,
    units: unitRows,
    charges,
    indexClause: clause,
    ...row
  }: LeaseRow,
  on: string,
) => {
  if (!terms) throw new Error(`Lease ${row.id} has no lease terms`)
  const { agreementId: _, organizationId: __, ...leaseFields } = terms
  const lease = { ...row, ...leaseFields }
  const now = currentTerms({ ...row, parties: partyRows, units: unitRows, charges }, on)
  const parties = shownRows(now.parties, partyRows)
  return {
    ...lease,
    // The base charge in force, as the familiar rent fields.
    rentOre: now.rentOre,
    rentInterval: now.rentInterval,
    vat: now.vat,
    baseChargeId: now.baseCharge?.id ?? null,
    charges: [...charges].sort((a, b) => a.fromDate.localeCompare(b.fromDate)),
    indexClause: clause
      ? {
          sharePercent: clause.sharePercent,
          baseMonth: clause.baseMonth,
          adjustmentMonth: clause.adjustmentMonth,
          floorAtBase: clause.floorAtBase,
        }
      : null,
    /** Every party and unit row with its dates, for corrections and history. */
    partyRows: partyRows.map(({ party, ...p }) => ({ ...p, name: party.name })),
    unitRows: unitRows.map(({ unit, ...u }) => ({ ...u, label: unit.label })),
    /** The tenant named first; the one the lease pages show. */
    tenant: primaryParty(parties).party,
    /** Every tenant's name, as the avier print them. */
    partyNames: joinNames(parties.map((p) => p.party.name)),
    parties: parties.map((p) => ({
      ...p.party,
      role: p.role,
      receivesInvoices: p.receivesInvoices,
    })),
    units: shownRows(now.units, unitRows)
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
      where: inCompany(agreement, organizationId, eq(agreement.kind, 'lease')),
      orderBy: desc(agreement.number),
      with: withLeaseDetails,
    }),
  )
  const on = yield* today
  return rows.map((row) => toView(row, on))
}).pipe(Effect.withSpan('leases.listLeases'))

export const getLease = Effect.fn('leases.getLease')(function* (leaseId: string) {
  yield* requirePermission(read)
  const row = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findFirst({
      where: inCompany(
        agreement,
        organizationId,
        eq(agreement.id, leaseId),
        eq(agreement.kind, 'lease'),
      ),
      with: withLeaseDetails,
    }),
  ).pipe(orNotFound('lease', leaseId))
  const view = toView(row, yield* today)
  // Contact details are tenant data, shown only to those who may read tenants.
  const contacts = (yield* hasPermission({ tenant: ['read'] }))
    ? yield* orgQuery((db, organizationId) =>
        db.query.party.findMany({
          columns: { id: true, email: true, phone: true },
          where: inCompany(
            party,
            organizationId,
            inArray(
              party.id,
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
    /** One-off charges an avi in force has billed; the rest are still to come. */
    billedChargeIds: [...(yield* billedOnceChargeIds([view.id]))],
    indexAdjustments: yield* indexAdjustments(view.id),
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

    return yield* checkUnitsFree(
      terms.unitIds,
      { start: terms.startDate, end: effectiveEndDate(terms) },
      exceptLeaseId,
    )
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
    yield* checkPartiesExist(input.coTenantIds)
    return result.parties
  })

/**
 * What the company's tier says about a lease: any new lease needs `leases` (a BRF's lettings), and
 * VAT or a lokal needs `commercial`. On an existing lease only what a change adds counts, so a
 * company on a smaller tier can still correct the leases it has.
 */
const requireLeasePlan = (
  terms: { readonly vat: boolean; readonly unitIds: readonly string[] },
  current?: { readonly vat: boolean; readonly unitIds: readonly string[] },
) =>
  Effect.gen(function* () {
    if (!current) yield* requireFeature('leases')
    const added = terms.unitIds.filter((id) => !current?.unitIds.includes(id))
    const premises =
      added.length === 0
        ? []
        : yield* orgQuery((db, organizationId) =>
            db
              .select({ id: unit.id })
              .from(unit)
              .where(
                inCompany(
                  unit,
                  organizationId,
                  inArray(unit.id, added),
                  eq(unit.kind, 'commercial'),
                ),
              ),
          )
    if ((terms.vat && !current?.vat) || premises.length > 0) yield* requireFeature('commercial')
  })

export const createLease = Effect.fn('leases.createLease')(function* (input: CreateLeaseInput) {
  yield* requirePermission(manage)
  yield* requireLeasePlan(input)
  const extensionMonths = input.termEndDate ? input.extensionMonths : null

  const owner = yield* orgQuery((db, organizationId) =>
    db.query.party.findFirst({
      columns: { id: true },
      where: inCompany(party, organizationId, eq(party.id, input.tenantId)),
    }),
  ).pipe(orNotFound('tenant', input.tenantId))

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
        invoiceInterval: input.invoiceInterval,
      }),
      db.insert(charge).values({
        organizationId,
        agreementId: leaseId,
        kind: 'rent',
        amountOre: input.rentOre,
        interval: input.rentInterval,
        vat: input.vat,
        fromDate: input.startDate,
      }),
      db.insert(leaseTerms).values({
        agreementId: leaseId,
        organizationId,
        termEndDate: input.termEndDate,
        extensionMonths,
        noticePeriodMonths: input.noticePeriodMonths,
      }),
      db.insert(agreementParty).values(
        parties.map((p) => ({
          ...p,
          agreementId: leaseId,
          organizationId,
          fromDate: input.startDate,
        })),
      ),
      db.insert(agreementUnit).values(
        unitIds.map((unitId) => ({
          agreementId: leaseId,
          unitId,
          organizationId,
          fromDate: input.startDate,
        })),
      ),
    ]),
  )
  return yield* getLease(leaseId)
})

/**
 * Changes the lease's units, co-tenants, dates and rent. The tenant stays: a new tenant is a new
 * lease.
 * Issued invoices are not touched, so the new terms only affect future invoice runs.
 */
export const updateLease = Effect.fn('leases.updateLease')(function* (input: UpdateLeaseInput) {
  yield* requirePermission(manage)
  const current = yield* getLease(input.leaseId)
  yield* requireLeasePlan(input, {
    vat: current.vat,
    unitIds: current.unitRows.map((u) => u.unitId),
  })
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
  yield* checkClauseAllows(current.id, { ...input, unitIds })
  const base = yield* correctBaseCharge(
    current,
    {
      startDate: input.startDate,
      amountOre: input.rentOre,
      interval: input.rentInterval,
      vat: input.vat,
    },
    yield* today,
  )
  if (!base) return yield* new Conflict({ message: 'Avtalet saknar hyra' })

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
          invoiceInterval: input.invoiceInterval,
        })
        .where(inCompany(agreement, organizationId, eq(agreement.id, current.id))),
      db
        .update(charge)
        .set(base.values)
        .where(inCompany(charge, organizationId, eq(charge.id, base.id))),
      db
        .update(leaseTerms)
        .set({
          termEndDate: input.termEndDate,
          extensionMonths,
          noticePeriodMonths: input.noticePeriodMonths,
        })
        .where(inCompany(leaseTerms, organizationId, eq(leaseTerms.agreementId, current.id))),
      ...correctOpenTerms(
        db,
        organizationId,
        current.id,
        { oldStart: current.startDate, newStart: input.startDate },
        { parties: current.partyRows, units: current.unitRows },
        { parties, unitIds },
      ),
    ]),
  )
  return yield* getLease(current.id)
})

export const terminateLease = Effect.fn('leases.terminateLease')(function* (
  input: TerminateLeaseInput,
) {
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
        .where(inCompany(leaseTerms, organizationId, eq(leaseTerms.agreementId, current.id))),
      db
        .update(agreement)
        .set({ endDate: moveOutDate })
        .where(inCompany(agreement, organizationId, eq(agreement.id, current.id))),
    ]),
  )
  return yield* getLease(current.id)
})

/**
 * Undoes a termination before the move-out date has passed. Fails if one of the units has been
 * leased to someone else after the move-out, since the lease would then overlap it.
 */
export const withdrawTermination = Effect.fn('leases.withdrawTermination')(function* (
  leaseId: string,
) {
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
          inCompany(
            leaseTerms,
            organizationId,
            eq(leaseTerms.agreementId, current.id), // Guards against a concurrent change between the read above and this write.
            eq(leaseTerms.moveOutDate, current.moveOutDate as string),
          ),
        ),
      db
        .update(agreement)
        .set({ endDate: effectiveEndDate({ ...current, moveOutDate: null }) })
        .where(
          inCompany(
            agreement,
            organizationId,
            eq(agreement.id, current.id),
            eq(agreement.endDate, current.moveOutDate as string),
          ),
        ),
    ]),
  )
  return yield* getLease(current.id)
})

/** Leases that were ever invoiced are accounting history; terminate them instead. */
export const deleteLease = Effect.fn('leases.deleteLease')(function* (leaseId: string) {
  yield* requirePermission(manage)
  const current = yield* getLease(leaseId)
  const history = yield* invoiceHistory(current.id)
  if (history.total > 0) {
    return yield* new Conflict({
      message: 'Avtalet har avier och kan inte tas bort. Säg upp det i stället.',
    })
  }
  yield* orgQuery((db, organizationId) =>
    db.delete(agreement).where(inCompany(agreement, organizationId, eq(agreement.id, current.id))),
  )
  return { tenantId: current.tenant.id }
})

const changeProblemMessages: Record<ChangePlanProblem, string> = {
  too_early: 'Datumet måste vara efter avtalets start. Ändra avtalet i stället för att rätta det.',
  after_end: 'Datumet är efter avtalets sista dag',
  no_change: 'Inget ändras från det datumet',
}

/**
 * Changes who is on the lease, who receives the avier, and its units from a date. Rows no longer
 * wanted end the day before; new ones start on the date; the rest are kept, so history stays.
 * The tenant stays: a new tenant is a new lease.
 */
export const changeLeaseFrom = Effect.fn('leases.changeLeaseFrom')(function* (
  input: ChangeLeaseFromInput,
) {
  yield* requirePermission(manage)
  const current = yield* getLease(input.leaseId)
  const before = { vat: current.vat, unitIds: current.unitRows.map((u) => u.unitId) }
  yield* requireLeasePlan({ vat: current.vat, unitIds: input.unitIds }, before)
  const parties = yield* checkParties(current.tenant.id, input)
  const partyKey = (p: { partyId: string; role: string; receivesInvoices: boolean }) =>
    `${p.partyId}:${p.role}:${p.receivesInvoices ? 1 : 0}`
  const partyPlan = planChange(
    current.partyRows.map((p) => ({ ...p, key: partyKey(p) })),
    parties.map(partyKey),
    input.fromDate,
  )
  const unitIds = [...new Set(input.unitIds)]
  const unitPlan = planChange(
    current.unitRows.map((u) => ({ ...u, key: u.unitId })),
    unitIds,
    input.fromDate,
  )
  const problem = changeDateProblem(current, input.fromDate, {
    end: [...partyPlan.end, ...unitPlan.end],
    remove: [...partyPlan.remove, ...unitPlan.remove],
    add: [...partyPlan.add, ...unitPlan.add],
  })
  if (problem) return yield* new Conflict({ message: changeProblemMessages[problem] })
  yield* checkClauseAllows(current.id, { ...current, unitIds })
  if (unitPlan.add.length > 0) {
    yield* checkUnitsFree(unitPlan.add, { start: input.fromDate, end: current.endDate }, current.id)
  }
  const added = parties.filter((p) => partyPlan.add.includes(partyKey(p)))

  yield* orgQuery((db, organizationId): Promise<unknown> => {
    const mine = <T extends { id: AnyColumn; organizationId: AnyColumn }>(table: T, id: string) =>
      inCompany(table, organizationId, eq(table.id, id))
    const statements = [
      ...partyPlan.end.map((r) =>
        db.update(agreementParty).set({ toDate: r.toDate }).where(mine(agreementParty, r.id)),
      ),
      ...partyPlan.remove.map((id) => db.delete(agreementParty).where(mine(agreementParty, id))),
      ...unitPlan.end.map((r) =>
        db.update(agreementUnit).set({ toDate: r.toDate }).where(mine(agreementUnit, r.id)),
      ),
      ...unitPlan.remove.map((id) => db.delete(agreementUnit).where(mine(agreementUnit, id))),
      ...(added.length > 0
        ? [
            db.insert(agreementParty).values(
              added.map((p) => ({
                ...p,
                agreementId: current.id,
                organizationId,
                fromDate: input.fromDate,
              })),
            ),
          ]
        : []),
      ...(unitPlan.add.length > 0
        ? [
            db.insert(agreementUnit).values(
              unitPlan.add.map((unitId) => ({
                agreementId: current.id,
                unitId,
                organizationId,
                fromDate: input.fromDate,
              })),
            ),
          ]
        : []),
    ]
    const [first, ...rest] = statements
    return first ? db.batch([first, ...rest]) : Promise.resolve([])
  })
  return yield* getLease(current.id)
})
