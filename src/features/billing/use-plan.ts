import { useRouteContext } from '@tanstack/react-router'
import { cheapestTierFor, homeFeatures, type PlanFeature, tierAllows, tiers } from './tiers'

/**
 * What the tiers allow, for hiding or explaining what isn't included. Features of a domain follow
 * the company in focus, a manager's own features the user's own company, as on the server
 * (`requireFeature`), which this mirrors but never replaces.
 */
export function usePlan() {
  const { app } = useRouteContext({ from: '/_app' })
  const tierFor = (feature: PlanFeature) => (homeFeatures.has(feature) ? app.homeTier : app.tier)
  return {
    tier: tiers[app.tier],
    allows: (feature: PlanFeature) => tierAllows(tierFor(feature), feature),
    /** The cheapest tier with the feature, of the company's own type; null if none has it. */
    needs: (feature: PlanFeature) => cheapestTierFor(tiers[tierFor(feature)].kind, feature),
  }
}
