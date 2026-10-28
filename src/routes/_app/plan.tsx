import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { AlertTriangle, Check, CreditCard, Minus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { PageHeader } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { planQuery } from '#/features/billing/functions'
import {
  type Cell,
  plans,
  quantityOf,
  salesEmail,
  type Tier,
  type TierId,
  tiers,
} from '#/features/billing/tiers'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { stockholmDate } from '#/lib/dates'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

// "Abonnemang": the company's tier, the tiers of its type side by side, and buying or changing
// one through Stripe (Better Auth's Stripe plugin). Only in the company's own view.
export const Route = createFileRoute('/_app/plan')({
  beforeLoad: ({ context }) => {
    if (context.app.organization.grant) {
      throw redirect({ to: '/plan', search: { company: undefined } })
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(planQuery()),
  component: PlanPage,
})

type Plan = typeof Route.types.loaderData

function PlanPage() {
  const { app } = Route.useRouteContext()
  const { data: plan } = useSuspenseQuery(planQuery())
  // Better Auth's Stripe plugin also checks that the user is an owner or admin here.
  const canBuy = useCan()({ settings: ['manage'] }) && plan.billingConfigured
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const kindPlan = plans[plan.kind]
  const current = tiers[plan.tier]
  const returnUrl = () => `${window.location.origin}/plan`

  const run = async (key: string, action: () => Promise<{ error: unknown }>) => {
    setPending(key)
    setError(null)
    const result = await action()
    // On success the browser is already on its way to Stripe.
    if (result.error) {
      setError(authErrorMessage(result.error as { code?: string; message?: string }))
      setPending(null)
    }
  }
  const choose = (tier: Tier) =>
    run(tier.id, () =>
      authClient.subscription.upgrade({
        plan: tier.id,
        referenceId: app.home.id,
        customerType: 'organization',
        seats: quantityOf(tier.id, plan.usage) ?? 1,
        // Changing tier changes the subscription the company has, never adds a second one.
        subscriptionId: plan.subscription?.id ?? undefined,
        successUrl: returnUrl(),
        cancelUrl: returnUrl(),
        locale: 'sv',
      }),
    )
  const manage = () =>
    run('portal', () =>
      authClient.subscription.billingPortal({
        referenceId: app.home.id,
        customerType: 'organization',
        returnUrl: returnUrl(),
        locale: 'sv',
      }),
    )

  return (
    <div className="grid gap-6 md:gap-8">
      <PageHeader
        title={m.nav_plan()}
        subtitle={m.plan_subtitle({ organization: app.home.name })}
        action={
          canBuy &&
          plan.subscription?.id && (
            <Button
              variant="outline"
              className="h-11 w-full sm:h-9 sm:w-auto"
              disabled={pending !== null}
              onClick={manage}
            >
              <CreditCard aria-hidden="true" />
              {m.plan_manage_payment()}
            </Button>
          )
        }
      />

      <CurrentTier plan={plan} />
      {!plan.billingConfigured && (
        <p className="rounded-xl border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          {m.plan_billing_not_configured()}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <section aria-label={m.plan_compare()} className="grid gap-3">
        <h2 className="font-semibold text-[15px]">{m.plan_compare()}</h2>
        {/* Desktop: the tiers side by side. */}
        <table className="hidden w-full table-fixed border-collapse text-left text-[13px] md:table">
          <thead>
            <tr>
              <th scope="col" className="w-2/5 p-3" />
              {kindPlan.tiers.map((id) => (
                <th
                  key={id}
                  scope="col"
                  className={cn(
                    'p-3 align-top font-normal',
                    id === plan.tier && 'rounded-t-xl bg-muted/60',
                  )}
                >
                  <TierHeading
                    tier={tiers[id]}
                    current={id === plan.tier}
                    action={
                      <TierAction
                        tier={tiers[id]}
                        plan={plan}
                        canBuy={canBuy}
                        pending={pending}
                        onChoose={choose}
                        onManage={manage}
                      />
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kindPlan.rows.map((row) => (
              <tr key={row.label()} className="border-t">
                <th scope="row" className="p-3 font-normal">
                  {row.label()}
                  {row.soon && <Soon />}
                </th>
                {row.cells.map((cell, i) => (
                  <td
                    key={kindPlan.tiers[i]}
                    className={cn('p-3', kindPlan.tiers[i] === plan.tier && 'bg-muted/60')}
                  >
                    <CellValue cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Phones: one card per tier with what it includes. */}
        <div className="grid gap-3 md:hidden">
          {kindPlan.tiers.map((id, column) => (
            <article
              key={id}
              className={cn(
                'grid gap-3 rounded-xl border bg-card p-4',
                id === plan.tier && 'border-foreground/30 bg-muted/40',
              )}
            >
              <TierHeading tier={tiers[id]} current={id === plan.tier} />
              <ul className="grid gap-2 text-[13px]">
                {kindPlan.rows.map((row) => (
                  <li key={row.label()} className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0">
                      <CellValue cell={row.cells[column]} compact />
                    </span>
                    <span className={cn(row.cells[column] === false && 'text-muted-foreground')}>
                      {row.label()}
                      {row.soon && <Soon />}
                      {typeof row.cells[column] === 'object' && (
                        <span className="text-muted-foreground">
                          {' '}
                          · <CellValue cell={row.cells[column]} />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <TierAction
                tier={tiers[id]}
                plan={plan}
                canBuy={canBuy}
                pending={pending}
                onChoose={choose}
                onManage={manage}
              />
            </article>
          ))}
        </div>
      </section>
      <p className="text-[13px] text-muted-foreground">{current.price && m.plan_prices_note()}</p>
    </div>
  )
}

/** The current tier, what it counts, and anything about the subscription that needs attention. */
function CurrentTier({ plan }: { plan: Plan }) {
  const tier = tiers[plan.tier]
  const sub = plan.subscription
  const lines = [
    plan.quantity !== null && quantityText(tier, plan.quantity),
    plan.byAgreement && m.plan_by_agreement(),
    sub?.cancelAtPeriodEnd && sub.periodEnd && m.plan_ends({ date: stockholmDate(sub.periodEnd) }),
    !sub?.cancelAtPeriodEnd &&
      sub?.periodEnd &&
      !plan.byAgreement &&
      m.plan_renews({ date: stockholmDate(sub.periodEnd) }),
  ].filter((l) => typeof l === 'string')
  return (
    <section
      aria-label={m.plan_current()}
      className="grid gap-1.5 rounded-xl border bg-card px-4 py-3.5 md:px-5"
    >
      <span className="text-muted-foreground text-xs">{m.plan_current()}</span>
      <span className="font-semibold text-lg">{tier.name()}</span>
      {lines.length > 0 && (
        <span className="text-[13px] text-muted-foreground">{lines.join(' · ')}</span>
      )}
      {sub?.status === 'past_due' && (
        <span className="flex items-center gap-1.5 text-[13px] text-amber-700 dark:text-amber-300">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          {m.plan_past_due()}
        </span>
      )}
    </section>
  )
}

const quantityText = (tier: Tier, quantity: number) => {
  switch (tier.quantity) {
    case 'apartments':
      return m.plan_quantity_apartments({ count: quantity })
    case 'units':
      return m.plan_quantity_units({ count: quantity })
    case 'members':
      return m.plan_quantity_members({ count: quantity })
    default:
      return null
  }
}

function TierHeading({
  tier,
  current,
  action,
}: {
  tier: Tier
  current: boolean
  action?: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-semibold text-[15px]">
          {tier.name()}
          {current && (
            <span className="rounded-full bg-foreground px-2 py-0.5 font-medium text-[11px] text-background">
              {m.plan_current_badge()}
            </span>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          {tier.price ? tier.price() : m.plan_free()}
        </span>
      </div>
      {action}
    </div>
  )
}

/** Choose a self-serve tier, contact sales, or (for the free tier) cancel through Stripe. */
function TierAction({
  tier,
  plan,
  canBuy,
  pending,
  onChoose,
  onManage,
}: {
  tier: Tier
  plan: Plan
  canBuy: boolean
  pending: string | null
  onChoose: (tier: Tier) => void
  onManage: () => void
}) {
  const button = 'h-11 w-full sm:h-9'
  if (tier.id === plan.tier) return null
  if (tier.sales) {
    return salesEmail ? (
      <Button asChild variant="outline" className={button}>
        <a href={`mailto:${salesEmail}?subject=${encodeURIComponent(tier.name())}`}>
          {m.plan_contact_sales()}
        </a>
      </Button>
    ) : (
      <span className="text-muted-foreground text-xs">{m.plan_contact_sales()}</span>
    )
  }
  if (!canBuy || plan.byAgreement) return null
  // Back to free: cancel the subscription in Stripe's portal.
  if (tier.price === null) {
    return plan.subscription?.id ? (
      <Button variant="ghost" className={button} disabled={pending !== null} onClick={onManage}>
        {m.plan_cancel()}
      </Button>
    ) : null
  }
  const cheaper = rank(tier.id) < rank(plan.tier)
  return (
    <Button
      variant={cheaper ? 'outline' : 'default'}
      className={button}
      disabled={pending !== null}
      onClick={() => onChoose(tier)}
    >
      {pending === tier.id
        ? m.plan_redirecting()
        : cheaper
          ? m.plan_switch({ tier: tier.name() })
          : m.plan_choose({ tier: tier.name() })}
    </Button>
  )
}

const rank = (id: TierId) => plans[tiers[id].kind].tiers.indexOf(id)

function CellValue({ cell, compact }: { cell: Cell; compact?: boolean }) {
  if (cell === true) {
    return (
      <Check
        aria-label={m.plan_included()}
        className="size-4 text-emerald-700 dark:text-emerald-300"
      />
    )
  }
  if (cell === false) {
    return <Minus aria-label={m.plan_not_included()} className="size-4 text-muted-foreground" />
  }
  if (compact) {
    return (
      <Check aria-label={cell.text()} className="size-4 text-emerald-700 dark:text-emerald-300" />
    )
  }
  return <span>{cell.text()}</span>
}

const Soon = () => (
  <span className="ml-1.5 whitespace-nowrap rounded-full border px-1.5 py-px text-[11px] text-muted-foreground">
    {m.plan_soon()}
  </span>
)
