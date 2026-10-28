import { Link } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { useIsOwnCompany } from '#/features/auth/use-can'
import { m } from '#/paraglide/messages'
import type { PlanFeature } from './tiers'
import { usePlan } from './use-plan'

/**
 * Says which tier includes a feature the company's tier lacks, where the feature would be; nothing
 * when it is included. In a managed company it only says so, since the plan isn't the manager's.
 */
export function PlanHint({ feature, className }: { feature: PlanFeature; className?: string }) {
  const plan = usePlan()
  const own = useIsOwnCompany()
  if (plan.allows(feature)) return null
  const needed = plan.needs(feature)
  return (
    <p
      className={`flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] text-muted-foreground ${className ?? ''}`}
    >
      <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {needed ? m.plan_hint_needs({ tier: needed.name() }) : m.plan_hint_unavailable()}
        {needed && own && (
          <>
            {' '}
            <Link
              to="/plan"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {m.plan_hint_link()}
            </Link>
          </>
        )}
      </span>
    </p>
  )
}
