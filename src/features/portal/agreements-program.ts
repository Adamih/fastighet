import { inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import { agreement } from '#/db/schema'
import { isBaseKind } from '#/features/agreements/charges'
import { currentTerms } from '#/features/agreements/current'
import { agreementTerms } from '#/features/agreements/terms'
import { tierAllows } from '#/features/billing/tiers'
import { leaseStatus } from '#/features/leases/terms'
import { NotFound } from '#/server/errors'
import { inCompany, portalQuery } from '#/server/scoped'
import { PortalCompany } from '#/server/services'
import { today } from '#/server/today'
import { visibleAgreementIds } from './scope'

// Agreements in Mina sidor: leases and bostadsrätter the person's parties are on, as the app
// shows them (current terms from `currentTerms`, status from `leaseStatus`).

const withDetails = {
  leaseTerms: true,
  indexClause: true,
  charges: true,
  parties: { with: { party: { columns: { name: true } } } },
  units: {
    with: {
      unit: {
        columns: { label: true, kind: true },
        with: { property: { columns: { designation: true, name: true, streetAddress: true } } },
      },
    },
  },
} as const

const loadVisible = (onlyId?: string) =>
  Effect.gen(function* () {
    const ids = yield* visibleAgreementIds
    const wanted = onlyId ? ids.filter((id) => id === onlyId) : ids
    if (wanted.length === 0) return []
    return yield* portalQuery((db, scope) =>
      db.query.agreement.findMany({
        where: inCompany(agreement, scope.organizationId, inArray(agreement.id, wanted)),
        orderBy: agreement.number,
        with: withDetails,
      }),
    )
  })

type Loaded = Effect.Success<ReturnType<typeof loadVisible>>[number]

/** What a list row shows: units, current rent or fee, status and dates. */
const summary = (a: Loaded, on: string) => {
  const terms = agreementTerms(a)
  const current = currentTerms(a, on)
  return {
    id: a.id,
    number: a.number,
    kind: a.kind,
    status: leaseStatus(terms, on),
    startDate: a.startDate,
    endDate: a.endDate,
    rentOre: current.rentOre,
    rentInterval: current.rentInterval,
    vat: current.vat,
    units: current.units.map(({ unit }) => ({
      label: unit.label,
      kind: unit.kind,
      designation: unit.property.designation,
      address: unit.property.streetAddress,
    })),
  }
}

/** The agreements the person sees, by number. */
export const portalAgreements = Effect.gen(function* () {
  const rows = yield* loadVisible()
  const on = yield* today
  return rows.map((a) => summary(a, on))
}).pipe(Effect.withSpan('portal.portalAgreements'))

export type PortalAgreement = Effect.Success<typeof portalAgreements>[number]

/**
 * One agreement: everyone on it, its units, the charges in force and those already decided for
 * later, and its terms. Details tied to features the app gates (index clauses: commercial
 * premises) follow the company's tier.
 */
export const portalAgreement = Effect.fn('portal.portalAgreement')(function* (agreementId: string) {
  const [a] = yield* loadVisible(agreementId)
  if (!a) return yield* new NotFound({ entity: 'agreement', id: agreementId })
  const on = yield* today
  const company = yield* PortalCompany
  const current = currentTerms(a, on)
  const recurring = a.charges.filter((c) => c.interval !== 'once')
  const inForce = recurring.filter(
    (c) => c.fromDate <= current.on && (!c.toDate || c.toDate >= current.on),
  )
  const upcoming = recurring
    .filter((c) => c.fromDate > on)
    .sort((x, y) => x.fromDate.localeCompare(y.fromDate))
  const charge = (c: (typeof a.charges)[number]) => ({
    id: c.id,
    kind: c.kind,
    base: isBaseKind(c.kind),
    description: c.description,
    amountOre: c.amountOre,
    interval: c.interval,
    vat: c.vat,
    fromDate: c.fromDate,
    toDate: c.toDate,
  })
  const terms = agreementTerms(a)
  return {
    ...summary(a, on),
    invoiceInterval: a.invoiceInterval,
    parties: current.parties.map((p) => ({
      id: p.partyId,
      name: p.party.name,
      role: p.role,
      sharePercent: p.sharePercent,
      receivesInvoices: p.receivesInvoices,
      mine: company.partyIds.includes(p.partyId),
    })),
    charges: inForce.map(charge),
    upcoming: upcoming.map(charge),
    terms: {
      termEndDate: terms.termEndDate,
      extensionMonths: terms.extensionMonths,
      noticePeriodMonths: terms.noticePeriodMonths,
      noticeDate: terms.noticeDate,
      moveOutDate: terms.moveOutDate,
    },
    indexClause:
      a.indexClause && tierAllows(company.tier, 'commercial')
        ? {
            sharePercent: a.indexClause.sharePercent,
            baseMonth: a.indexClause.baseMonth,
            adjustmentMonth: a.indexClause.adjustmentMonth,
          }
        : null,
  }
})

export type PortalAgreementDetail = Effect.Success<ReturnType<typeof portalAgreement>>
