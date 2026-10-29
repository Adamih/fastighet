import { useRouteContext } from '@tanstack/react-router'
import { type PlanFeature, tierAllows } from '#/features/billing/tiers'

/**
 * Whether the company in focus in Mina sidor has a feature in its tier. The portal has no gates of
 * its own: only views tied to features the app gates follow the tier.
 */
export function usePortalPlan() {
  const { portal } = useRouteContext({ from: '/portal/_portal' })
  return (feature: PlanFeature) =>
    portal.company ? tierAllows(portal.company.tier, feature) : false
}
