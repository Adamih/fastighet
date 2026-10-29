import { eq, inArray } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { agreement, agreementParty, organizationSettings } from '#/db/schema'
import { registerEntryIn } from '#/features/ownerships/program'
import { pledgesIn } from '#/features/pledges/program'
import { NotFound } from '#/server/errors'
import { inCompany, inParties, portalQuery } from '#/server/scoped'
import { PortalCompany } from '#/server/services'
import { today } from '#/server/today'
import { visibleAgreementIds } from './scope'

// A BRF member's own bostadsrätt in Mina sidor: the apartment register's entry for it, its
// pledges in priority order, and an extract of the register for it (as the app produces one).

/** The visible bostadsrätter, by number. */
const ownershipIds = Effect.gen(function* () {
  const ids = yield* visibleAgreementIds
  if (ids.length === 0) return [] as string[]
  const rows = yield* portalQuery((db, scope) =>
    db
      .select({ id: agreement.id })
      .from(agreement)
      .where(
        inCompany(
          agreement,
          scope.organizationId,
          inArray(agreement.id, ids),
          eq(agreement.kind, 'tenant_ownership'),
        ),
      )
      .orderBy(agreement.number),
  )
  return rows.map((r) => r.id)
})

/** The day a bostadsrätt is shown as of: today, or its last day once sold. */
const asOf = (on: string) => (row: { startDate: string; endDate: string | null }) =>
  row.endDate !== null && row.endDate < on ? row.endDate : on

/** The person's bostadsrätter with the register's entry and their pledges. */
export const portalApartments = Effect.gen(function* () {
  const ids = yield* ownershipIds
  const company = yield* PortalCompany
  const on = yield* today
  const pledges = yield* pledgesIn(company.id, ids)
  return yield* Effect.forEach(ids, (id) =>
    Effect.map(registerEntryIn(company.id, id, asOf(on)), (entry) => ({
      ...entry,
      pledges: (pledges.get(id) ?? []).map((p) => ({
        id: p.id,
        priority: p.priority,
        active: p.active,
        creditorName: p.creditorName,
        notifiedOn: p.notifiedOn,
        releasedOn: p.releasedOn,
      })),
    })),
  )
}).pipe(Effect.withSpan('portal.portalApartments'))

export type PortalApartment = Effect.Success<typeof portalApartments>[number]

/**
 * An extract from the apartment register for one of the person's bostadsrätter, as of today (or
 * its last day once sold): the förening, the apartment, its holders and the pledges in force, in
 * priority order. Producing it is recorded in the audit log, as the party asking.
 */
export const portalExtract = Effect.fn('portal.portalExtract')(function* (ownershipId: string) {
  if (!(yield* ownershipIds).includes(ownershipId)) {
    return yield* new NotFound({ entity: 'ownership', id: ownershipId })
  }
  const company = yield* PortalCompany
  const on = yield* today
  const entry = yield* registerEntryIn(company.id, ownershipId, asOf(on))
  const onDate = asOf(on)(entry.ownership)
  const pledges = (yield* pledgesIn(company.id, [ownershipId], onDate)).get(ownershipId) ?? []
  const [association] = yield* portalQuery((db, scope) =>
    db
      .select({ organizationNumber: organizationSettings.organizationNumber })
      .from(organizationSettings)
      .where(inCompany(organizationSettings, scope.organizationId)),
  )
  const [asking] = yield* portalQuery((db, scope) =>
    db
      .select({ partyId: agreementParty.partyId })
      .from(agreementParty)
      .where(inParties(agreementParty, scope, eq(agreementParty.agreementId, ownershipId))),
  )
  return {
    onDate,
    association: {
      name: company.name,
      organizationNumber: association?.organizationNumber ?? null,
    },
    ownership: entry.ownership,
    apartment: entry.apartment,
    otherUnits: entry.otherUnits,
    holders: entry.holders,
    pledges: pledges
      .filter((p) => p.active)
      .map((p) => ({
        priority: p.priority as number,
        creditorName: p.creditorName,
        creditorOrganizationNumber: p.creditorOrganizationNumber,
        notifiedOn: p.notifiedOn,
      })),
    producedAt: yield* Clock.currentTimeMillis,
    /** The party it was produced for, for the audit log. */
    partyId: asking?.partyId ?? company.partyIds[0],
  }
})

export type PortalExtract = Effect.Success<ReturnType<typeof portalExtract>>
