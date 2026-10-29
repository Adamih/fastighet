import { Effect } from 'effect'
import { companyKindLabels } from '#/features/settings/company-kinds'
import { requireOwnCompany, requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { query } from '#/server/scoped'
import { Billing, CurrentOrganization, HomeOrganization } from '#/server/services'
import { planState, usageOf } from './store'
import {
  cheapestTierFor,
  homeFeatures,
  limitReached,
  type PlanFeature,
  quantityOf,
  tierAllows,
  tiers,
} from './tiers'

// What the company's tier allows, checked like permissions: domain programs start with
// `yield* requireFeature(...)` next to `requirePermission`. Features of a domain are checked in
// the company in focus (a managed company's own tier applies); a manager's own features
// (`homeFeatures`) in the user's home company.

const planOf = (organizationId: string) => query((db) => planState(db, organizationId))

/** Fails with a Conflict that names the tier the feature needs, if the company's tier lacks it. */
export const requireFeature = (feature: PlanFeature) =>
  Effect.gen(function* () {
    const company = homeFeatures.has(feature) ? yield* HomeOrganization : yield* CurrentOrganization
    const plan = yield* planOf(company.id)
    if (tierAllows(plan.tier, feature)) return
    const needed = cheapestTierFor(plan.kind, feature)
    return yield* new Conflict({
      message: needed
        ? `Det här ingår inte i ${tiers[plan.tier].name()}. Det finns i ${needed.name()} och uppåt (Abonnemang).`
        : `Det här finns inte för ${companyKindLabels[plan.kind].toLowerCase()}.`,
    })
  })

/** Fails when one more unit would go past the tier's backstop (the free landlord tier). */
export const requireRoomForUnit = Effect.gen(function* () {
  const company = yield* CurrentOrganization
  const plan = yield* planOf(company.id)
  const usage = yield* query((db) => usageOf(db, company.id))
  if (!limitReached(plan.tier, 'units', usage)) return
  return yield* new Conflict({
    message: `${tiers[plan.tier].name()} räcker för ${tiers[plan.tier].limits.units} lägenheter och lokaler. Välj ett större abonnemang under Abonnemang.`,
  })
})

/**
 * After units change: sets the subscription's quantity from the next bill. A failure is logged,
 * never thrown; the write has happened and the next change, or checkout, corrects it.
 */
export const syncPlanQuantity = Effect.gen(function* () {
  const company = yield* CurrentOrganization
  const billing = yield* Billing
  yield* billing
    .syncQuantity(company.id)
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logError('Could not sync the subscription quantity', cause),
      ),
    )
})

/** The company's tier, what decides it and what it counts; for the app context and plan page. */
export const companyPlan = (organizationId: string) =>
  Effect.gen(function* () {
    const plan = yield* planOf(organizationId)
    const usage = yield* query((db) => usageOf(db, organizationId))
    const sub = plan.subscription
    return {
      kind: plan.kind,
      tier: plan.tier,
      /** Set by us (a sales deal or an older company), not by a subscription. */
      byAgreement: plan.override !== null && plan.override === plan.tier,
      subscription: sub && {
        id: sub.stripeSubscriptionId,
        plan: sub.plan,
        status: sub.status,
        periodEnd: sub.periodEnd?.getTime() ?? null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
      },
      usage,
      quantity: quantityOf(plan.tier, usage),
    }
  })

/** The plan page: the user's own company only, for those who can see its settings. */
export const getPlan = Effect.gen(function* () {
  yield* requireOwnCompany
  yield* requirePermission({ settings: ['read'] })
  const company = yield* CurrentOrganization
  const billing = yield* Billing
  return { ...(yield* companyPlan(company.id)), billingConfigured: billing.configured }
})
