import { desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { Effect, Option } from 'effect'
import {
  agreement,
  agreementParty,
  charge,
  indexAdjustment,
  indexClause,
  invoice,
  kpi,
  unit,
} from '#/db/schema'
import {
  dayBefore,
  isBaseKind,
  retroactiveDescription,
  retroactiveDifference,
} from '#/features/agreements/charges'
import { invoiceRecipient } from '#/features/agreements/parties'
import { inForce, inForceOn } from '#/features/agreements/periods'
import { requireFeature } from '#/features/billing/program'
import { loadCompanyDetails } from '#/features/settings/program'
import { sellerDetails } from '#/features/settings/seller'
import { formatSek } from '#/lib/money'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { bestEffort } from '#/server/best-effort'
import { Conflict, NotFound } from '#/server/errors'
import { sendEmail } from '#/server/mail/mailer'
import { inCompany, orgQuery, query } from '#/server/scoped'
import { KpiSource } from '#/server/services'
import { today } from '#/server/today'
import {
  adjustmentDate,
  type ClauseProblem,
  clauseProblem,
  formatKpi,
  indexSupplement,
  kpiMonthFor,
  monthLabel,
  perYear,
} from './rules'
import type { IndexClauseInput } from './schemas'

// Index clauses on leases and the yearly indexation (indexuppräkning). The base rent charge
// stays as agreed; the supplement is an `index` charge that each year's run ends and replaces.

const read: Permissions = { lease: ['read'] }
const manage: Permissions = { lease: ['manage'] }

export const clauseProblemMessages: Record<ClauseProblem, string> = {
  residential:
    'Bostadshyror kan inte indexeras. En indexklausul gäller bara lokaler (12 kap. 19 § jordabalken).',
  not_fixed_term:
    'En indexklausul kräver att lokalen hyrs ut på bestämd tid i minst tre år. Ange ett slutdatum.',
  too_short: 'En indexklausul kräver att avtalstiden är minst tre år (12 kap. 19 § jordabalken).',
}

/** A lease with what the clause rules need: its kind, dates, term end and unit kinds. */
const leaseForClause = (leaseId: string) =>
  Effect.gen(function* () {
    const row = yield* orgQuery((db, organizationId) =>
      db.query.agreement.findFirst({
        where: inCompany(
          agreement,
          organizationId,
          eq(agreement.id, leaseId),
          eq(agreement.kind, 'lease'),
        ),
        with: { leaseTerms: true, units: { with: { unit: { columns: { kind: true } } } } },
      }),
    )
    if (!row?.leaseTerms) return yield* new NotFound({ entity: 'lease', id: leaseId })
    return {
      id: row.id,
      startDate: row.startDate,
      termEndDate: row.leaseTerms.termEndDate,
      unitKinds: row.units.map((u) => u.unit.kind),
    }
  })

/** Adds or changes the lease's index clause, after checking that the lease may have one. */
export const setIndexClause = Effect.fn('indexation.setIndexClause')(function* (
  input: IndexClauseInput,
) {
  yield* requirePermission(manage)
  yield* requireFeature('commercial')
  const lease = yield* leaseForClause(input.leaseId)
  const problem = clauseProblem(lease)
  if (problem) return yield* new Conflict({ message: clauseProblemMessages[problem] })
  const values = {
    sharePercent: input.sharePercent,
    baseMonth: input.baseMonth,
    adjustmentMonth: input.adjustmentMonth,
    floorAtBase: input.floorAtBase,
  }
  yield* orgQuery((db, organizationId) =>
    db
      .insert(indexClause)
      .values({ agreementId: lease.id, organizationId, ...values })
      .onConflictDoUpdate({ target: indexClause.agreementId, set: values }),
  )
})

/**
 * Removes the clause. A clause that an indexation has used stays, as the record of why the
 * lease has its index supplement.
 */
export const removeIndexClause = Effect.fn('indexation.removeIndexClause')(function* (
  leaseId: string,
) {
  yield* requirePermission(manage)
  const lease = yield* leaseForClause(leaseId)
  const [used] = yield* orgQuery((db, organizationId) =>
    db
      .select({ id: indexAdjustment.id })
      .from(indexAdjustment)
      .where(inCompany(indexAdjustment, organizationId, eq(indexAdjustment.agreementId, lease.id)))
      .limit(1),
  )
  if (used) {
    return yield* new Conflict({
      message: 'Indexklausulen har använts i en indexuppräkning och kan inte tas bort',
    })
  }
  yield* orgQuery((db, organizationId) =>
    db
      .delete(indexClause)
      .where(inCompany(indexClause, organizationId, eq(indexClause.agreementId, lease.id))),
  )
})

/** The lease's adjustments, newest first, for its page. */
export const indexAdjustments = (leaseId: string) =>
  orgQuery((db, organizationId) =>
    db
      .select()
      .from(indexAdjustment)
      .where(inCompany(indexAdjustment, organizationId, eq(indexAdjustment.agreementId, leaseId)))
      .orderBy(desc(indexAdjustment.effectiveDate)),
  )

/** KPI values by month. Reference data shared by every company; read only. */
const kpiValues = (months: readonly string[]) =>
  query((db) =>
    months.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(kpi)
          .where(inArray(kpi.month, [...new Set(months)])),
  ).pipe(Effect.map((rows) => new Map(rows.map((r) => [r.month, r.valueHundredths]))))

/**
 * Fetches KPI months newer than the latest one stored, from SCB. Values come from SCB only, so
 * no company can change what another one's indexation uses. A failed fetch leaves the months
 * missing; the preview then says what is missing.
 */
export const syncKpi = Effect.gen(function* () {
  const source = yield* KpiSource
  const fetched = yield* source.fetch.pipe(
    Effect.catchTag('KpiFetchError', () => Effect.succeed([] as const)),
  )
  const [latest] = yield* query((db) =>
    db.select({ month: kpi.month }).from(kpi).orderBy(desc(kpi.month)).limit(1),
  )
  const fresh = fetched.filter((r) => !latest || r.month > latest.month)
  if (fresh.length === 0) return 0
  yield* query((db) => db.insert(kpi).values(fresh).onConflictDoNothing())
  return fresh.length
}).pipe(Effect.withSpan('indexation.syncKpi'))

export type IndexationStatus = 'ready' | 'done' | 'missing_kpi' | 'no_rent' | 'invalid_clause'

/** Every lease with an index clause that runs on its adjustment date in `year`, with its numbers. */
const plan = (year: number) =>
  Effect.gen(function* () {
    const rows = yield* orgQuery((db, organizationId) =>
      db.query.agreement.findMany({
        where: inCompany(agreement, organizationId, eq(agreement.kind, 'lease')),
        orderBy: agreement.number,
        with: {
          indexClause: true,
          leaseTerms: true,
          charges: true,
          units: { with: { unit: { columns: { kind: true } } } },
          parties: {
            orderBy: agreementParty.position,
            with: {
              party: {
                columns: {
                  id: true,
                  name: true,
                  streetAddress: true,
                  postalCode: true,
                  city: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    )
    const leases = rows.flatMap((row) => {
      const clause = row.indexClause
      if (!clause || !row.leaseTerms) return []
      const date = adjustmentDate(year, clause.adjustmentMonth)
      if (row.startDate > date || (row.endDate !== null && row.endDate < date)) return []
      return [{ row, clause, date, kpiMonth: kpiMonthFor(date) }]
    })
    const months = leases.flatMap((l) => [l.clause.baseMonth, l.kpiMonth])
    let values = yield* kpiValues(months)
    if (months.some((m) => !values.has(m))) {
      if ((yield* syncKpi) > 0) values = yield* kpiValues(months)
    }
    const done = yield* orgQuery((db, organizationId) =>
      leases.length === 0
        ? Promise.resolve([])
        : db
            .select({
              agreementId: indexAdjustment.agreementId,
              date: indexAdjustment.effectiveDate,
            })
            .from(indexAdjustment)
            .where(
              inCompany(
                indexAdjustment,
                organizationId,
                inArray(
                  indexAdjustment.agreementId,
                  leases.map((l) => l.row.id),
                ),
              ),
            ),
    )
    return leases.map(({ row, clause, date, kpiMonth }) => {
      const base = row.charges.find((c) => isBaseKind(c.kind) && !c.unitId && inForceOn(c, date))
      const current = row.charges.find((c) => c.kind === 'index' && inForceOn(c, dayBefore(date)))
      const baseKpi = values.get(clause.baseMonth) ?? null
      const kpiValue = values.get(kpiMonth) ?? null
      const baseRentPerYearOre = base ? perYear(base.amountOre, base.interval) : 0
      const currentSupplementOre = current ? perYear(current.amountOre, current.interval) : 0
      const problem = clauseProblem({
        startDate: row.startDate,
        termEndDate: row.leaseTerms?.termEndDate ?? null,
        unitKinds: row.units.map((u) => u.unit.kind),
      })
      const status: IndexationStatus = done.some((d) => d.agreementId === row.id && d.date === date)
        ? 'done'
        : problem
          ? 'invalid_clause'
          : !base
            ? 'no_rent'
            : baseKpi === null || kpiValue === null
              ? 'missing_kpi'
              : 'ready'
      const newSupplementOre =
        base && baseKpi !== null && kpiValue !== null
          ? indexSupplement({
              baseRentPerYearOre,
              sharePercent: clause.sharePercent,
              baseKpi,
              kpi: kpiValue,
              floorAtBase: clause.floorAtBase,
            })
          : null
      const parties = inForce(row.parties, date)
      const recipient = invoiceRecipient(parties.length > 0 ? parties : row.parties)
      return {
        leaseId: row.id,
        number: row.number,
        tenantName: recipient.recipientName,
        recipientEmail: recipient.recipientEmail,
        agreement: { startDate: row.startDate, endDate: row.endDate },
        effectiveDate: date,
        status,
        sharePercent: clause.sharePercent,
        baseMonth: clause.baseMonth,
        baseKpi,
        kpiMonth,
        kpi: kpiValue,
        baseRentPerYearOre,
        currentSupplementOre,
        newSupplementOre,
        vat: base?.vat ?? false,
        current: current ?? null,
      }
    })
  })

/** What the indexation for `year` would do, lease by lease. */
export const indexationPreview = Effect.fn('indexation.indexationPreview')(function* (
  year: number,
) {
  yield* requirePermission(read)
  return (yield* plan(year)).map(({ current: _, agreement: __, recipientEmail, ...row }) => ({
    ...row,
    hasEmail: recipientEmail !== null,
  }))
})

export type IndexationRow = Effect.Success<ReturnType<typeof indexationPreview>>[number]

/**
 * Adjusts every ready lease for `year`: the index charge in force ends the day before the
 * adjustment date and a new one starts with the new supplement; the base rent stays. Days from
 * that date that avier have already billed are made up on the next avi. Leases already adjusted
 * for the date are skipped, so the run can be repeated. A missing KPI value blocks the run.
 */
export const runIndexation = Effect.fn('indexation.runIndexation')(function* (
  year: number,
  options: { notify: boolean } = { notify: false },
) {
  yield* requirePermission(manage)
  yield* requireFeature('commercial')
  const rows = yield* plan(year)
  const missing = [
    ...new Set(
      rows
        .filter((r) => r.status === 'missing_kpi')
        .flatMap((r) => [
          r.baseKpi === null ? r.baseMonth : null,
          r.kpi === null ? r.kpiMonth : null,
        ])
        .filter((m): m is string => m !== null),
    ),
  ].sort()
  if (missing.length > 0) {
    return yield* new Conflict({
      message: `KPI för ${missing.map(monthLabel).join(', ')} finns inte än. SCB publicerar KPI i mitten av månaden efter.`,
    })
  }
  const on = yield* today
  const seller = options.notify ? yield* loadCompanyDetails : null
  let adjusted = 0
  const notices = { sent: 0, noEmail: 0, failed: 0 }
  for (const r of rows) {
    if (r.status !== 'ready' || r.newSupplementOre === null) continue
    const supplement = r.newSupplementOre
    // Periods of avier in force that already cover the adjustment date.
    const invoiced = yield* orgQuery((db, organizationId) =>
      db
        .select({ start: invoice.periodStart, end: invoice.periodEnd })
        .from(invoice)
        .where(
          inCompany(
            invoice,
            organizationId,
            eq(invoice.agreementId, r.leaseId),
            gte(invoice.periodEnd, r.effectiveDate),
            isNull(invoice.voidedAt),
            sql`${invoice.creditedOre} < ${invoice.totalOre}`,
          ),
        )
        .orderBy(desc(invoice.periodEnd)),
    )
    const old = {
      amountOre: r.currentSupplementOre,
      interval: 'yearly' as const,
      fromDate: r.effectiveDate,
      toDate: null,
    }
    const difference = retroactiveDifference(
      old,
      supplement,
      r.effectiveDate,
      r.agreement,
      invoiced,
    )
    const chargeId = supplement === 0 ? null : crypto.randomUUID()
    const adjustmentId = crypto.randomUUID()
    yield* orgQuery((db, organizationId): Promise<unknown> => {
      const statements = [
        ...(r.current
          ? [
              db
                .update(charge)
                .set({ toDate: dayBefore(r.effectiveDate) })
                .where(inCompany(charge, organizationId, eq(charge.id, r.current.id))),
            ]
          : []),
        ...(chargeId
          ? [
              db.insert(charge).values({
                id: chargeId,
                organizationId,
                agreementId: r.leaseId,
                kind: 'index',
                amountOre: supplement,
                interval: 'yearly',
                vat: r.vat,
                fromDate: r.effectiveDate,
              }),
            ]
          : []),
        // After the charge it points at.
        db.insert(indexAdjustment).values({
          id: adjustmentId,
          organizationId,
          agreementId: r.leaseId,
          effectiveDate: r.effectiveDate,
          baseMonth: r.baseMonth,
          baseKpiHundredths: r.baseKpi as number,
          kpiMonth: r.kpiMonth,
          kpiHundredths: r.kpi as number,
          baseRentOre: r.baseRentPerYearOre,
          supplementOre: supplement,
          chargeId,
        }),
        ...(difference !== 0 && invoiced[0]
          ? [
              db.insert(charge).values({
                organizationId,
                agreementId: r.leaseId,
                kind: 'one_off',
                description: retroactiveDescription('index', r.effectiveDate, invoiced[0].end),
                amountOre: difference,
                interval: 'once',
                vat: r.vat,
                fromDate: on,
              }),
            ]
          : []),
      ]
      const [first, ...rest] = statements
      return db.batch([first, ...rest])
    })
    adjusted += 1

    // The rent has changed whether or not the notice gets through; a failed email is counted,
    // and the adjustment shows that no notice was sent.
    if (!seller) continue
    if (!r.recipientEmail) {
      notices.noEmail += 1
      continue
    }
    const sent = yield* sendEmail({
      to: r.recipientEmail,
      template: 'rentAdjustment',
      props: {
        recipientName: r.tenantName,
        organizationName: seller.organizationName,
        leaseLabel: `avtal ${r.number}`,
        effectiveDate: r.effectiveDate,
        baseRent: formatSek(r.baseRentPerYearOre),
        previousSupplement: formatSek(r.currentSupplementOre),
        newSupplement: formatSek(supplement),
        newRent: formatSek(r.baseRentPerYearOre + supplement),
        vatNote: r.vat ? 'exkl. moms' : null,
        share: `${r.sharePercent} %`,
        kpi: `${formatKpi(r.kpi as number)} (${monthLabel(r.kpiMonth)})`,
        baseKpi: `${formatKpi(r.baseKpi as number)} (${monthLabel(r.baseMonth)})`,
        retroactive: difference !== 0 && invoiced[0] ? formatSek(difference) : null,
        sellerDetails: sellerDetails(seller, r.vat),
      },
    }).pipe(bestEffort(`Could not send rent adjustment notice (${adjustmentId})`))
    if (Option.isNone(sent)) {
      notices.failed += 1
      continue
    }
    notices.sent += 1
    yield* orgQuery((db, organizationId) =>
      db
        .update(indexAdjustment)
        .set({ notifiedAt: new Date() })
        .where(inCompany(indexAdjustment, organizationId, eq(indexAdjustment.id, adjustmentId))),
    )
  }
  return { adjusted, skipped: rows.length - adjusted, notices }
})

/**
 * That a lease's index clause, if it has one, stays valid with these terms: a lease edit can't
 * make it residential, open-ended or shorter than three years.
 */
export const checkClauseAllows = Effect.fn('indexation.checkClauseAllows')(function* (
  leaseId: string,
  terms: { startDate: string; termEndDate: string | null; unitIds: readonly string[] },
) {
  const clause = yield* orgQuery((db, organizationId) =>
    db.query.indexClause.findFirst({
      columns: { agreementId: true },
      where: inCompany(indexClause, organizationId, eq(indexClause.agreementId, leaseId)),
    }),
  )
  if (!clause) return
  const units = yield* orgQuery((db, organizationId) =>
    db.query.unit.findMany({
      columns: { kind: true },
      where: inCompany(unit, organizationId, inArray(unit.id, [...terms.unitIds])),
    }),
  )
  const problem = clauseProblem({ ...terms, unitKinds: units.map((u) => u.kind) })
  if (problem) {
    return yield* new Conflict({
      message: `Avtalet har en indexklausul. ${clauseProblemMessages[problem]}`,
    })
  }
})
