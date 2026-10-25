import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Mail, Pencil, Phone, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  DetailColumns,
  DetailHeader,
  FactList,
  MoreActions,
  Panel,
  PanelRow,
  StatRow,
} from '#/components/detail'
import { InitialsAvatar } from '#/components/initials-avatar'
import { StatCard } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import { useCan } from '#/features/auth/use-can'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { owedOrTotal } from '#/features/invoicing/credit'
import { invoiceOverview } from '#/features/invoicing/overview'
import { periodLabel } from '#/features/invoicing/rules'
import { formatPeriod, LeaseStatusBadge } from '#/features/leases/components'
import { tenantKindLabels } from '#/features/leases/options'
import { formatShortDate, monthlyRentOre } from '#/features/leases/overview'
import { deleteTenantFn, tenantQuery } from '#/features/tenants/functions'
import { useEditTenantDrawer } from '#/features/tenants/tenant-form'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/tenants/$tenantId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(tenantQuery(params.tenantId)),
  component: TenantPage,
})

function TenantPage() {
  const { tenantId } = Route.useParams()
  const can = useCan()
  const canManage = can({ tenant: ['manage'] })
  const { data: tenant } = useSuspenseQuery(tenantQuery(tenantId))
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const edit = useEditTenantDrawer(tenant)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const today = stockholmDate(Date.now())

  const remove = useMutation({
    mutationFn: deleteTenantFn,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: tenantQuery(tenantId).queryKey })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
      await navigate({ to: '/tenants' })
    },
  })

  const current = tenant.leases.filter((l) => l.status !== 'ended')
  const running = tenant.leases.filter((l) => l.status === 'active' || l.status === 'terminated')
  const upcoming = tenant.leases.filter((l) => l.status === 'upcoming')
  // Before the first lease starts, show what the rent will be.
  const rentLeases = running.length > 0 ? running : upcoming
  const rent = rentLeases.reduce((sum, l) => sum + monthlyRentOre(l), 0)
  const firstStart = upcoming.map((l) => l.startDate).sort()[0]
  const invoices = invoiceOverview(tenant.invoices, today)
  const address = [
    tenant.streetAddress,
    [tenant.postalCode, tenant.city].filter(Boolean).join(' '),
  ].filter(Boolean)

  return (
    <div className="grid gap-6 md:gap-7">
      <DetailHeader
        back={{ label: m.nav_tenants(), to: '/tenants' }}
        crumb={tenant.name}
        title={
          <span className="flex items-center gap-3">
            <InitialsAvatar
              name={tenant.name}
              square={tenant.kind === 'company'}
              className="size-10 text-sm"
            />
            {tenant.name}
          </span>
        }
        meta={[tenantKindLabels[tenant.kind], tenant.organizationNumber]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canManage && (
            <>
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={edit.open}>
                <Pencil aria-hidden="true" />
                {m.tenant_edit()}
              </Button>
              {tenant.leases.length === 0 && can({ lease: ['read'] }) && (
                <MoreActions label={m.common_more_actions_for({ name: tenant.name })}>
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden="true" />
                    {m.tenant_delete()}
                  </DropdownMenuItem>
                </MoreActions>
              )}
            </>
          )
        }
      />

      {confirmDelete && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <span className="min-w-0 flex-1">{m.tenant_delete_confirm({ name: tenant.name })}</span>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="h-11 flex-1 sm:h-9"
              onClick={() => setConfirmDelete(false)}
            >
              {m.common_cancel()}
            </Button>
            <Button
              variant="destructive"
              className="h-11 flex-1 sm:h-9"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ data: { tenantId } })}
            >
              {m.common_delete()}
            </Button>
          </div>
          {remove.error && (
            <p className="w-full text-destructive text-sm">{remove.error.message}</p>
          )}
        </section>
      )}

      <StatRow>
        <StatCard
          label={m.nav_leases()}
          hint={
            tenant.leases.length > current.length
              ? m.tenant_leases_total({ count: tenant.leases.length })
              : undefined
          }
        >
          {current.length === 0
            ? m.tenant_leases_none()
            : m.tenant_leases_current({ count: current.length })}
        </StatCard>
        <StatCard
          label={m.common_rent()}
          hint={
            running.length === 0 && firstStart
              ? m.common_from_date({ date: formatShortDate(firstStart) })
              : rentLeases.some((l) => l.vat)
                ? m.common_excl_vat()
                : undefined
          }
        >
          {formatSekShort(rent)}
          <span className="font-medium text-muted-foreground text-sm"> {m.common_per_month()}</span>
        </StatCard>
        {can({ invoice: ['read'] }) && (
          <StatCard
            label={m.common_outstanding()}
            tone={invoices.overdue.count > 0 ? 'danger' : 'default'}
            hint={
              invoices.overdue.count > 0
                ? m.invoice_count_overdue({ count: invoices.overdue.count })
                : invoices.outstanding.count > 0
                  ? m.invoice_count_unpaid({ count: invoices.outstanding.count })
                  : m.invoice_none_unpaid()
            }
          >
            {formatSekShort(invoices.outstanding.totalOre)}
          </StatCard>
        )}
        <StatCard
          label={m.nav_invoices()}
          hint={tenant.email ? m.tenant_delivery_email_hint() : m.tenant_delivery_print_hint()}
          hintClass={tenant.email ? undefined : 'text-amber-700 dark:text-amber-300'}
        >
          {tenant.email ? m.common_email() : m.tenant_delivery_print()}
        </StatCard>
      </StatRow>

      <DetailColumns
        main={
          <>
            {can({ lease: ['read'] }) && (
              <Panel title={m.nav_leases()}>
                {tenant.leases.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">{m.lease_list_empty()}</p>
                ) : (
                  <div>
                    {tenant.leases.map((l) => (
                      <PanelRow key={l.id}>
                        <span className="grid min-w-0 gap-0.5">
                          <Link
                            to="/leases/$leaseId"
                            params={{ leaseId: l.id }}
                            className="font-semibold underline-offset-4 hover:underline"
                          >
                            {m.lease_number({ number: l.number })}
                          </Link>
                          <span className="truncate text-muted-foreground tabular-nums">
                            {formatPeriod(l)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="hidden font-semibold tabular-nums sm:inline">
                            {formatSekShort(l.rentOre)}
                            <span className="font-normal text-muted-foreground">
                              {' '}
                              {l.rentInterval === 'monthly'
                                ? m.common_per_month()
                                : m.common_per_year()}
                            </span>
                          </span>
                          <LeaseStatusBadge status={l.status} />
                        </span>
                      </PanelRow>
                    ))}
                  </div>
                )}
              </Panel>
            )}
            {can({ invoice: ['read'] }) && (
              <Panel title={m.tenant_recent_invoices()}>
                {tenant.invoices.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">{m.invoice_list_empty()}</p>
                ) : (
                  <div>
                    {tenant.invoices.slice(0, 6).map((i) => (
                      <PanelRow key={i.id}>
                        <Link
                          to="/invoices/$invoiceId"
                          params={{ invoiceId: i.id }}
                          className="min-w-0 truncate underline-offset-4 hover:underline"
                        >
                          <span className="font-semibold">#{i.number}</span>{' '}
                          <span className="text-muted-foreground">
                            · {periodLabel({ start: i.periodStart, end: i.periodEnd })}
                          </span>
                        </Link>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="font-semibold tabular-nums">
                            {formatSekShort(owedOrTotal(i))}
                          </span>
                          <InvoiceStatusBadge status={i.status} />
                        </span>
                      </PanelRow>
                    ))}
                  </div>
                )}
              </Panel>
            )}
          </>
        }
        side={
          <Panel title={m.tenant_contact()}>
            {tenant.email || tenant.phone ? (
              <div className="grid gap-1.5 text-[13px]">
                {tenant.email && (
                  <a
                    href={`mailto:${tenant.email}`}
                    className="flex min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <Mail aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{tenant.email}</span>
                  </a>
                )}
                {tenant.phone && (
                  <a
                    href={`tel:${tenant.phone.replace(/[^\d+]/g, '')}`}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    <Phone aria-hidden="true" className="size-3.5 shrink-0" />
                    {tenant.phone}
                  </a>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-amber-700 dark:text-amber-300">
                {m.tenant_no_contact()}
              </p>
            )}
            <div className="border-t pt-3">
              <FactList
                facts={[
                  [m.common_kind(), tenantKindLabels[tenant.kind]],
                  ...(tenant.organizationNumber
                    ? ([[m.common_organization_number_short(), tenant.organizationNumber]] as const)
                    : []),
                  [m.tenant_form_billing_address(), address.join(', ') || '–'],
                ]}
              />
            </div>
          </Panel>
        }
      />
    </div>
  )
}
