import type { AnyColumn } from 'drizzle-orm'
import { count, desc, eq, inArray, isNull, min, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Db } from '#/db'
import {
  agreement,
  agreementParty,
  agreementUnit,
  charge,
  invoice,
  invoiceLine,
  party,
  paymentReminder,
  unit,
} from '#/db/schema'
import { periodsOverlap } from '#/features/leases/terms'
import { maxDate, minDate } from '#/lib/dates'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { today } from '#/server/today'
import {
  type ChangeProblem,
  changeProblem,
  dayBefore,
  isBaseKind,
  retroactiveDescription,
  retroactiveDifference,
} from './charges'
import { inForceOn } from './periods'
import type { AddOneOffChargeInput } from './schemas'

// Checks shared by every kind of agreement (leases and bostadsrätter). No permission checks of
// their own: the calling program has already made them.

/**
 * That every unit belongs to the company and has no other agreement during the period, whatever
 * its kind (`exceptId` leaves out the agreement being edited). Returns the de-duplicated ids.
 *
 * Not atomic with the write that follows; acceptable while each company has a handful of users.
 */
export const checkUnitsFree = Effect.fn('agreements.checkUnitsFree')(function* (
  unitIds: readonly string[],
  period: { start: string; end: string | null },
  exceptId?: string,
) {
  const ids = [...new Set(unitIds)]
  const units = yield* orgQuery((db, organizationId) =>
    db.query.unit.findMany({
      columns: { id: true, label: true },
      where: inCompany(unit, organizationId, inArray(unit.id, ids)),
      with: { agreements: { with: { agreement: true } } },
    }),
  )
  if (units.length !== ids.length) {
    return yield* new NotFound({ entity: 'unit', id: ids.join(',') })
  }
  // Another agreement holds the unit from the later of its start and the unit row's first
  // day, to the earlier of its last billed day and the row's last day.
  for (const u of units) {
    for (const { agreement: other, ...row } of u.agreements) {
      if (other.id === exceptId) continue
      const start = maxDate(other.startDate, row.fromDate)
      const ends = [other.endDate, row.toDate].filter((d): d is string => d !== null)
      const end = ends.length > 0 ? ends.reduce((a, b) => minDate(a, b)) : null
      if (end !== null && end < start) continue
      if (periodsOverlap(period, { start, end })) {
        return yield* new Conflict({
          message: `Objekt ${u.label} har redan ett avtal under perioden (avtal ${other.number})`,
        })
      }
    }
  }
  return ids
})

/** That every party belongs to the company. */
export const checkPartiesExist = Effect.fn('agreements.checkPartiesExist')(function* (
  partyIds: readonly string[],
) {
  if (partyIds.length === 0) return
  const found = yield* orgQuery((db, organizationId) =>
    db
      .select({ id: party.id })
      .from(party)
      .where(inCompany(party, organizationId, inArray(party.id, [...partyIds]))),
  )
  if (found.length !== new Set(partyIds).size) {
    return yield* new NotFound({ entity: 'party', id: partyIds.join(',') })
  }
})

/** Avier on the agreement: how many exist at all, and the first period that was invoiced. */
export const invoiceHistory = (agreementId: string) =>
  orgQuery((db, organizationId) =>
    db
      .select({
        total: count(),
        firstActivePeriod: min(
          sql`case when ${invoice.voidedAt} is null then ${invoice.periodStart} end`,
        ),
        lastPeriodEnd: sql<
          string | null
        >`max(case when ${invoice.voidedAt} is null then ${invoice.periodEnd} end)`,
      })
      .from(invoice)
      .where(inCompany(invoice, organizationId, eq(invoice.agreementId, agreementId))),
  ).pipe(
    Effect.map(([row]) => ({
      total: row?.total ?? 0,
      firstActivePeriod: (row?.firstActivePeriod as string | null) ?? null,
      lastPeriodEnd: row?.lastPeriodEnd ?? null,
    })),
  )

/**
 * The one-off charges on these agreements that an avi in force has already billed, so a run or
 * a corrected avi doesn't bill them again.
 */
export const billedOnceChargeIds = Effect.fn('agreements.billedOnceChargeIds')(function* (
  agreementIds: readonly string[],
) {
  if (agreementIds.length === 0) return new Set<string>()
  const rows = yield* orgQuery((db, organizationId) =>
    db
      .select({ chargeId: invoiceLine.chargeId })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
      .innerJoin(charge, eq(charge.id, invoiceLine.chargeId))
      .where(
        inCompany(
          invoice,
          organizationId,
          inArray(invoice.agreementId, [...agreementIds]),
          eq(charge.interval, 'once'),
          isNull(invoice.voidedAt),
          sql`${invoice.creditedOre} < ${invoice.totalOre}`,
        ),
      ),
  )
  return new Set(rows.flatMap((r) => (r.chargeId ? [r.chargeId] : [])))
})

/** Whether any avi (even a voided one) has billed the charge; then it can only change by date. */
export const chargeIsBilled = (chargeId: string) =>
  orgQuery((db, organizationId) =>
    db
      .select({ n: count() })
      .from(invoiceLine)
      .where(inCompany(invoiceLine, organizationId, eq(invoiceLine.chargeId, chargeId))),
  ).pipe(Effect.map(([row]) => (row?.n ?? 0) > 0))

/**
 * The avi that billed each one-off charge, for "billed on avi N" links and to know which can
 * still be removed. A voided avi counts too (its lines keep the charge), but a live one wins.
 */
export const billingAvier = Effect.fn('agreements.billingAvier')(function* (
  chargeIds: readonly (string | null)[],
) {
  const ids = [...new Set(chargeIds.filter((id): id is string => id !== null))]
  const result = new Map<string, { id: string; number: number; voided: boolean }>()
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const rows = yield* orgQuery((db, organizationId) =>
      db
        .select({
          chargeId: invoiceLine.chargeId,
          id: invoice.id,
          number: invoice.number,
          voidedAt: invoice.voidedAt,
        })
        .from(invoiceLine)
        .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
        .where(inCompany(invoiceLine, organizationId, inArray(invoiceLine.chargeId, batch))),
    )
    for (const { chargeId, voidedAt, ...avi } of rows) {
      if (!chargeId) continue
      const found = result.get(chargeId)
      if (!found || (found.voided && !voidedAt)) {
        result.set(chargeId, { ...avi, voided: voidedAt !== null })
      }
    }
  }
  return result
})

const changeProblemMessages: Record<ChangeProblem, string> = {
  too_early: 'Den nya hyran måste börja efter att den nuvarande började. Rätta beloppet i stället.',
  ended: 'Den nuvarande hyran har redan upphört',
  same_amount: 'Beloppet är detsamma som nu',
  negative: 'Beloppet kan inte vara negativt',
}

const manageAgreements: Permissions = { lease: ['manage'] }

/**
 * A new rent (or fee) from a date: the base charge in force then ends the day before and a new
 * one starts. Days from the date that avier in force already billed at the old amount are made
 * up on the next avi as a one-off line. All in one batch.
 */
export const changeBaseCharge = Effect.fn('agreements.changeBaseCharge')(function* (input: {
  agreementId: string
  fromDate: string
  amountOre: number
}) {
  yield* requirePermission(manageAgreements)
  const found = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findFirst({
      where: inCompany(agreement, organizationId, eq(agreement.id, input.agreementId)),
      with: { charges: true },
    }),
  ).pipe(orNotFound('agreement', input.agreementId))
  if (found.endDate && input.fromDate > found.endDate) {
    return yield* new Conflict({ message: `Avtalet upphör ${found.endDate}` })
  }
  const base = found.charges.filter((c) => isBaseKind(c.kind))
  const current =
    base.find((c) => inForceOn(c, input.fromDate)) ?? base.filter((c) => c.toDate === null).at(-1)
  if (!current) return yield* new Conflict({ message: 'Avtalet har ingen hyra att ändra' })
  const problem = changeProblem(current, input.fromDate, input.amountOre)
  if (problem) return yield* new Conflict({ message: changeProblemMessages[problem] })

  // Periods of avier in force that billed the current charge.
  const invoiced = yield* orgQuery((db, organizationId) =>
    db
      .selectDistinct({ start: invoice.periodStart, end: invoice.periodEnd })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
      .where(
        inCompany(
          invoice,
          organizationId,
          eq(invoiceLine.chargeId, current.id),
          isNull(invoice.voidedAt),
          sql`${invoice.creditedOre} < ${invoice.totalOre}`,
        ),
      )
      .orderBy(desc(invoice.periodEnd)),
  )
  const difference = retroactiveDifference(
    current,
    input.amountOre,
    input.fromDate,
    found,
    invoiced,
  )
  const lastInvoiced = invoiced[0]?.end
  const on = yield* today
  const id = crypto.randomUUID()
  yield* orgQuery((db, organizationId): Promise<unknown> => {
    const statements = [
      db
        .update(charge)
        .set({ toDate: dayBefore(input.fromDate) })
        .where(inCompany(charge, organizationId, eq(charge.id, current.id))),
      db.insert(charge).values({
        id,
        organizationId,
        agreementId: found.id,
        kind: current.kind,
        description: current.description,
        amountOre: input.amountOre,
        interval: current.interval,
        vat: current.vat,
        fromDate: input.fromDate,
        toDate: current.toDate,
      }),
    ] as const
    if (difference === 0 || !lastInvoiced) return db.batch([...statements])
    return db.batch([
      ...statements,
      db.insert(charge).values({
        organizationId,
        agreementId: found.id,
        kind: 'one_off',
        description: retroactiveDescription(current.kind, input.fromDate, lastInvoiced),
        amountOre: difference,
        interval: 'once',
        vat: current.vat,
        fromDate: on,
      }),
    ])
  })
  return { chargeId: id, retroactiveOre: difference }
})

/**
 * The statements that correct an agreement's open terms (rows without an end) to `next`: the
 * parties and units it has from now on, as if they had always been so. Rows that already ended
 * stay as history. A row keeps its first day, except one that began on the old start date,
 * which moves with it to the new one.
 */
export function correctOpenTerms(
  db: Db,
  organizationId: string,
  agreementId: string,
  dates: { oldStart: string; newStart: string },
  existing: {
    parties: readonly { partyId: string; fromDate: string; toDate: string | null }[]
    units: readonly { unitId: string; fromDate: string; toDate: string | null }[]
  },
  next: {
    parties: readonly {
      partyId: string
      role: 'tenant' | 'co_tenant' | 'owner'
      sharePercent?: number | null
      receivesInvoices: boolean
      position: number
    }[]
    unitIds: readonly string[]
  },
) {
  const firstDay = (fromDate: string | undefined) =>
    !fromDate || fromDate === dates.oldStart ? dates.newStart : fromDate
  const openParty = (id: string) =>
    existing.parties.find((p) => p.partyId === id && p.toDate === null)?.fromDate
  const openUnit = (id: string) =>
    existing.units.find((u) => u.unitId === id && u.toDate === null)?.fromDate
  const mine = <T extends { agreementId: AnyColumn; organizationId: AnyColumn; toDate: AnyColumn }>(
    table: T,
  ) => inCompany(table, organizationId, eq(table.agreementId, agreementId), isNull(table.toDate))
  return [
    db.delete(agreementParty).where(mine(agreementParty)),
    db.insert(agreementParty).values(
      next.parties.map((p) => ({
        ...p,
        agreementId,
        organizationId,
        fromDate: firstDay(openParty(p.partyId)),
      })),
    ),
    db.delete(agreementUnit).where(mine(agreementUnit)),
    db.insert(agreementUnit).values(
      next.unitIds.map((unitId) => ({
        agreementId,
        unitId,
        organizationId,
        fromDate: firstDay(openUnit(unitId)),
      })),
    ),
  ] as const
}

/**
 * Corrects the base charge in force (amount, interval, VAT) when nothing has billed it yet, and
 * moves its first day with the agreement's start. Once billed, the amount only changes from a
 * date (`changeBaseCharge`).
 */
export const correctBaseCharge = Effect.fn('agreements.correctBaseCharge')(function* (
  agreementRow: { id: string; startDate: string; charges: readonly (typeof charge.$inferSelect)[] },
  next: { startDate: string; amountOre: number; interval: 'monthly' | 'yearly'; vat: boolean },
  on: string,
) {
  const base = agreementRow.charges.filter((c) => isBaseKind(c.kind))
  const current = base.find((c) => inForceOn(c, on)) ?? base.at(-1)
  if (!current) return null
  const changed =
    current.amountOre !== next.amountOre ||
    current.interval !== next.interval ||
    current.vat !== next.vat
  if (changed && (yield* chargeIsBilled(current.id))) {
    return yield* new Conflict({
      message: 'Hyran är aviserad. Ändra den från ett datum med "Ändra hyra" i stället.',
    })
  }
  const fromDate = current.fromDate === agreementRow.startDate ? next.startDate : current.fromDate
  return {
    id: current.id,
    values: { amountOre: next.amountOre, interval: next.interval, vat: next.vat, fromDate },
  }
})

/** Adds a one-off amount (engångsbelopp) to an agreement; the next avi covering its date bills it. */
export const addOneOffCharge = Effect.fn('agreements.addOneOffCharge')(function* (
  input: AddOneOffChargeInput,
) {
  yield* requirePermission(manageAgreements)
  const found = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findFirst({
      columns: { id: true, startDate: true },
      where: inCompany(agreement, organizationId, eq(agreement.id, input.agreementId)),
    }),
  ).pipe(orNotFound('agreement', input.agreementId))
  if (input.fromDate < found.startDate) {
    return yield* new Conflict({ message: `Avtalet börjar ${found.startDate}` })
  }
  const id = crypto.randomUUID()
  yield* orgQuery((db, organizationId) =>
    db.insert(charge).values({
      id,
      organizationId,
      agreementId: found.id,
      kind: 'one_off',
      description: input.description.trim(),
      amountOre: input.amountOre,
      interval: 'once',
      vat: input.vat,
      fromDate: input.fromDate,
    }),
  )
  return { id }
})

/** Removes a one-off amount that no avi has billed yet. Billed ones are history. */
export const removeOneOffCharge = Effect.fn('agreements.removeOneOffCharge')(function* (
  chargeId: string,
) {
  yield* requirePermission(manageAgreements)
  const found = yield* orgQuery((db, organizationId) =>
    db.query.charge.findFirst({
      where: inCompany(charge, organizationId, eq(charge.id, chargeId)),
    }),
  ).pipe(orNotFound('charge', chargeId))
  if (found.interval !== 'once') {
    return yield* new Conflict({ message: 'Bara engångsbelopp kan tas bort' })
  }
  if (yield* chargeIsBilled(found.id)) {
    return yield* new Conflict({
      message: 'Beloppet är aviserat. Kreditera avin i stället.',
    })
  }
  const on = yield* today
  yield* orgQuery((db, organizationId) =>
    db.batch([
      // Removing a reminder fee waives it: the reminder says so and lets go of the charge.
      db
        .update(paymentReminder)
        .set({ feeChargeId: null, feeWaivedOn: on, feeWaiver: 'by_hand' })
        .where(
          inCompany(paymentReminder, organizationId, eq(paymentReminder.feeChargeId, found.id)),
        ),
      db.delete(charge).where(inCompany(charge, organizationId, eq(charge.id, found.id))),
    ]),
  )
  return { agreementId: found.agreementId }
})
