import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useRouteContext } from '@tanstack/react-router'
import { ChevronRight, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { InitialsAvatar } from '#/components/initials-avatar'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { tenantKindLabels } from '#/features/leases/options'
import { companyTerms } from '#/features/settings/terminology'
import { tenantsQuery } from '#/features/tenants/functions'
import { leaseLine, matchesTenant, tenantCountLine } from '#/features/tenants/overview'
import { useAddTenantDrawer } from '#/features/tenants/tenant-form'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/tenants/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(tenantsQuery()),
  component: TenantsPage,
})

type Tenant = (typeof Route.types.loaderData)[number]

function TenantsPage() {
  const canManage = useCan()({ tenant: ['manage'] })
  const { app } = useRouteContext({ from: '/_app' })
  const { data: tenants } = useSuspenseQuery(tenantsQuery())
  const [query, setQuery] = useState('')
  const addTenant = useAddTenantDrawer()
  const visible = tenants.filter((t) => matchesTenant(t, query))

  return (
    <div className={cn('grid gap-5 md:gap-7', canManage && 'pb-20 md:pb-0')}>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <h1 className="font-bold text-2xl tracking-tight md:text-3xl">
            {companyTerms(app.companyKind).parties}
          </h1>
          {tenants.length > 0 && (
            <p className="text-muted-foreground text-sm">{tenantCountLine(tenants)}</p>
          )}
        </div>
        <div className="flex w-full items-center gap-2.5 md:w-auto">
          {tenants.length > 0 && (
            <label className="flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border bg-background px-3 md:h-10 md:w-72">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="sr-only">{m.tenant_search_label()}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={m.tenant_search_placeholder()}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          )}
          {canManage && (
            <Button size="fab" onClick={addTenant.open}>
              <Plus aria-hidden="true" />
              {m.tenant_add()}
            </Button>
          )}
        </div>
      </header>

      <div className="grid items-start gap-6">
        {tenants.length === 0 ? (
          <p className="text-muted-foreground">{m.tenant_list_empty()}</p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">
            {m.tenant_list_no_match()}
          </p>
        ) : (
          <>
            {/* Phone: one card of tappable rows. */}
            <ul className="divide-y overflow-hidden rounded-xl border bg-card md:hidden">
              {visible.map((t) => (
                <li key={t.id}>
                  <Link
                    to="/tenants/$tenantId"
                    params={{ tenantId: t.id }}
                    className="flex min-h-16 items-center gap-3 px-4 py-3 text-foreground hover:bg-muted/40 hover:text-foreground"
                  >
                    <InitialsAvatar
                      name={t.name}
                      square={t.kind === 'company'}
                      className="size-10"
                    />
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="truncate font-semibold text-[15px]">{t.name}</span>
                      <TenantMeta tenant={t} />
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop: the table. */}
            <section className="hidden overflow-hidden rounded-xl border bg-card md:block">
              <table className="w-full border-collapse text-left text-[13px] lg:text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className={th}>{m.common_name()}</th>
                    <th className={th}>{m.tenant_contact()}</th>
                    <th className={cn(th, 'hidden lg:table-cell')}>{m.nav_leases()}</th>
                    <th className={th}>
                      <span className="sr-only">{m.common_actions()}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <TenantRow key={t.id} tenant={t} canManage={canManage} />
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

const th = 'whitespace-nowrap px-3 py-2.5 font-semibold lg:px-4 lg:py-3'
const td = 'px-3 py-3 lg:px-4'

const missingEmailClass =
  'justify-self-start whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 text-xs dark:bg-amber-950 dark:text-amber-200'

/** The phone row's second line: company details, email, or a warning when there is none. */
function TenantMeta({ tenant }: { tenant: Tenant }) {
  if (tenant.kind === 'company') {
    return (
      <span className="truncate text-[13px] text-muted-foreground tabular-nums">
        {[tenantKindLabels.company, tenant.organizationNumber].filter(Boolean).join(' · ')}
      </span>
    )
  }
  if (tenant.email) {
    return <span className="truncate text-[13px] text-muted-foreground">{tenant.email}</span>
  }
  return <span className={missingEmailClass}>{m.tenant_missing_email()}</span>
}

function TenantRow({ tenant, canManage }: { tenant: Tenant; canManage: boolean }) {
  const leases = leaseLine(tenant.leases)
  const addEmail = !tenant.email && canManage
  return (
    <tr className="border-b last:border-b-0">
      <td className={td}>
        <div className="flex items-center gap-3">
          <InitialsAvatar name={tenant.name} square={tenant.kind === 'company'} />
          <div className="grid min-w-0 gap-0.5">
            <Link
              to="/tenants/$tenantId"
              params={{ tenantId: tenant.id }}
              className="font-semibold underline-offset-4 hover:underline"
            >
              {tenant.name}
            </Link>
            <span className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
              {[tenantKindLabels[tenant.kind], tenant.organizationNumber]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {/* Below lg the lease column folds in here. */}
            {leases && (
              <span className="whitespace-nowrap text-muted-foreground text-xs lg:hidden">
                {m.tenant_lease_line({ leases })}
              </span>
            )}
          </div>
        </div>
      </td>
      <td className={cn(td, 'text-[13px]')}>
        {tenant.email ? (
          <span
            title={tenant.email}
            className="block max-w-56 truncate text-muted-foreground lg:max-w-none"
          >
            {tenant.email}
          </span>
        ) : (
          <span className={missingEmailClass}>
            {m.tenant_missing_email()}
            <span className="hidden lg:inline"> · {m.tenant_missing_email_consequence()}</span>
          </span>
        )}
      </td>
      <td className={cn(td, 'hidden whitespace-nowrap text-[13px] lg:table-cell')}>
        {leases ?? <span className="text-muted-foreground">–</span>}
      </td>
      <td className={cn(td, 'whitespace-nowrap text-right')}>
        <Link
          to="/tenants/$tenantId"
          params={{ tenantId: tenant.id }}
          aria-label={
            addEmail
              ? m.tenant_add_email_for({ name: tenant.name })
              : m.common_view_named({ name: tenant.name })
          }
          className="font-semibold text-[13px] underline-offset-4 hover:underline"
        >
          {addEmail ? m.tenant_add_email() : m.common_view()}
        </Link>
      </td>
    </tr>
  )
}
