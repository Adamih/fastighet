import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { DetailHeader, FactList, Panel, PanelRow } from '#/components/detail'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { adminCompanyQuery, setPlanOverrideFn } from '#/features/admin/functions'
import { roleText } from '#/features/admin/labels'
import { isTierId, plans, tiers } from '#/features/billing/tiers'
import { companyKindLabels } from '#/features/settings/company-kinds'
import { submissionError } from '#/lib/app-errors'
import { stockholmDate } from '#/lib/dates'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/admin/companies/$organizationId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(adminCompanyQuery(params.organizationId)),
  component: CompanyPage,
})

type Company = typeof Route.types.loaderData

function CompanyPage() {
  const { organizationId } = Route.useParams()
  const { data: company } = useSuspenseQuery(adminCompanyQuery(organizationId))
  const sub = company.subscription
  return (
    <div className="grid gap-6">
      <DetailHeader
        back={{ label: m.admin_nav_companies(), to: '/admin/companies' }}
        crumb={company.name}
        title={company.name}
        meta={[companyKindLabels[company.kind], company.organizationNumber]
          .filter(Boolean)
          .join(' · ')}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={m.admin_company()}>
          <FactList
            facts={[
              [m.admin_created(), stockholmDate(company.createdAt)],
              [m.common_organization_number(), company.organizationNumber ?? '–'],
              [m.company_details_email(), company.email ?? '–'],
              [m.admin_usage(), m.admin_usage_value({ ...company.usage })],
            ]}
          />
        </Panel>
        <Panel title={m.admin_tier()}>
          <FactList
            facts={[
              [m.admin_tier(), tiers[company.tier].name()],
              [
                m.admin_tier_decided_by(),
                company.override
                  ? m.admin_tier_by_agreement()
                  : sub
                    ? m.admin_tier_by_subscription()
                    : m.admin_tier_free(),
              ],
              ...(sub
                ? ([
                    [
                      m.admin_subscription(),
                      `${isTierId(sub.plan) ? tiers[sub.plan].name() : sub.plan} · ${sub.status}`,
                    ],
                    [
                      m.admin_subscription_period(),
                      sub.periodEnd
                        ? `${sub.cancelAtPeriodEnd ? m.admin_ends() : m.admin_renews()} ${stockholmDate(sub.periodEnd)}`
                        : '–',
                    ],
                    [m.admin_subscription_quantity(), sub.seats === null ? '–' : String(sub.seats)],
                  ] as const)
                : []),
            ]}
          />
          <OverrideForm company={company} />
        </Panel>
        <Panel title={m.admin_members()}>
          {company.members.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{m.admin_no_members()}</p>
          ) : (
            <div>
              {company.members.map((u) => (
                <PanelRow key={u.userId}>
                  <span className="grid min-w-0">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: u.userId }}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {u.name}
                    </Link>
                    <span className="truncate text-muted-foreground">{u.email}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">{roleText(u.role)}</span>
                </PanelRow>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={m.admin_management()}>
          <FactList
            facts={[
              [m.admin_managed_by(), <CompanyLinks key="by" companies={company.managedBy} />],
              [m.admin_manages(), <CompanyLinks key="of" companies={company.manages} />],
            ]}
          />
        </Panel>
      </div>
    </div>
  )
}

function CompanyLinks({ companies }: { companies: readonly { id: string; name: string }[] }) {
  if (companies.length === 0) return <>–</>
  return (
    <span className="grid">
      {companies.map((c) => (
        <Link
          key={c.id}
          to="/admin/companies/$organizationId"
          params={{ organizationId: c.id }}
          className="underline-offset-4 hover:underline"
        >
          {c.name}
        </Link>
      ))}
    </span>
  )
}

const NONE = 'none'

/** A tier by agreement (sales deal, pilot) for the company's type, or none. */
function OverrideForm({ company }: { company: Company }) {
  const queryClient = useQueryClient()
  const [tier, setTier] = useState(company.override ?? NONE)
  const save = useMutation({
    mutationFn: () =>
      setPlanOverrideFn({
        data: { organizationId: company.id, tier: tier === NONE ? null : tier },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  })
  return (
    <form
      className="grid gap-2 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <label htmlFor="override" className="font-medium text-sm">
        {m.admin_override()}
      </label>
      <p className="text-[13px] text-muted-foreground">{m.admin_override_hint()}</p>
      <div className="flex flex-wrap gap-2">
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger id="override" className="h-11 min-w-56 flex-1 sm:h-9 sm:flex-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{m.admin_override_none()}</SelectItem>
            {plans[company.kind].tiers.map((id) => (
              <SelectItem key={id} value={id}>
                {tiers[id].name()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="submit"
          className="h-11 w-full sm:h-9 sm:w-auto"
          disabled={save.isPending || tier === (company.override ?? NONE)}
        >
          {m.common_save_changes()}
        </Button>
      </div>
      {save.error && (
        <p role="alert" className="text-destructive text-sm">
          {submissionError(save.error).message}
        </p>
      )}
    </form>
  )
}
