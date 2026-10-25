import { and, count, eq, inArray, min, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { invoice, party, unit } from '#/db/schema'
import { periodsOverlap } from '#/features/leases/terms'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'

// Checks shared by every kind of agreement (leases and bostadsrätter). No permission checks of
// their own: the calling program has already made them.

/**
 * That every unit belongs to the company and has no other agreement during the period, whatever
 * its kind (`exceptId` leaves out the agreement being edited). Returns the de-duplicated ids.
 *
 * Not atomic with the write that follows; acceptable while each company has a handful of users.
 */
export const checkUnitsFree = (
  unitIds: readonly string[],
  period: { start: string; end: string | null },
  exceptId?: string,
) =>
  Effect.gen(function* () {
    const ids = [...new Set(unitIds)]
    const units = yield* orgQuery((db, organizationId) =>
      db.query.unit.findMany({
        columns: { id: true, label: true },
        where: and(eq(unit.organizationId, organizationId), inArray(unit.id, ids)),
        with: { agreements: { with: { agreement: true } } },
      }),
    )
    if (units.length !== ids.length) {
      return yield* new NotFound({ entity: 'unit', id: ids.join(',') })
    }
    // An agreement's `endDate` is its last day.
    for (const u of units) {
      for (const { agreement: other } of u.agreements) {
        if (other.id === exceptId) continue
        if (periodsOverlap(period, { start: other.startDate, end: other.endDate })) {
          return yield* new Conflict({
            message: `Objekt ${u.label} har redan ett avtal under perioden (avtal ${other.number})`,
          })
        }
      }
    }
    return ids
  })

/** That every party belongs to the company. */
export const checkPartiesExist = (partyIds: readonly string[]) =>
  Effect.gen(function* () {
    if (partyIds.length === 0) return
    const found = yield* orgQuery((db, organizationId) =>
      db
        .select({ id: party.id })
        .from(party)
        .where(and(eq(party.organizationId, organizationId), inArray(party.id, [...partyIds]))),
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
      .where(and(eq(invoice.organizationId, organizationId), eq(invoice.agreementId, agreementId))),
  ).pipe(
    Effect.map(([row]) => ({
      total: row?.total ?? 0,
      firstActivePeriod: (row?.firstActivePeriod as string | null) ?? null,
      lastPeriodEnd: row?.lastPeriodEnd ?? null,
    })),
  )
