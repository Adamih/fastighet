import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { PageHeader, StatCard } from '#/components/responsive'
import { adminOverviewQuery } from '#/features/admin/functions'
import { plans, tiers } from '#/features/billing/tiers'
import { companyKindLabels, companyKinds } from '#/features/settings/company-kinds'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/admin/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminOverviewQuery()),
  component: OverviewPage,
})

function OverviewPage() {
  const { data } = useSuspenseQuery(adminOverviewQuery())
  const count = (tier: string) => data.byTier.find((t) => t.tier === tier)?.count ?? 0
  return (
    <div className="grid gap-6 md:gap-8">
      <PageHeader title={m.admin_nav_overview()} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={m.admin_users_count()}>{data.users}</StatCard>
        <StatCard label={m.admin_companies_count()}>{data.companies}</StatCard>
        <StatCard label={m.admin_paying_count()}>{data.payingSubscriptions}</StatCard>
      </div>
      <section className="grid gap-3">
        <h2 className="font-semibold text-[15px]">{m.admin_by_tier()}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {companyKinds.map((kind) => (
            <div key={kind} className="grid gap-2 rounded-xl border bg-card p-4">
              <span className="font-medium text-sm">{companyKindLabels[kind]}</span>
              <ul className="grid gap-1 text-[13px]">
                {plans[kind].tiers.map((tier) => (
                  <li key={tier} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{tiers[tier].name()}</span>
                    <span className="font-medium tabular-nums">{count(tier)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
