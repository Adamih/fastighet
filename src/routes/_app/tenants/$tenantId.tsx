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
import { FormDrawer } from '#/components/form-drawer'
import { InitialsAvatar } from '#/components/initials-avatar'
import { StatCard } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import { useCan } from '#/features/auth/use-can'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { invoiceCount, invoiceOverview } from '#/features/invoicing/overview'
import { periodLabel } from '#/features/invoicing/rules'
import { formatPeriod, LeaseStatusBadge } from '#/features/leases/components'
import { tenantKindLabels } from '#/features/leases/options'
import { formatShortDate, monthlyRentOre } from '#/features/leases/overview'
import { deleteTenantFn, tenantQuery, updateTenantFn } from '#/features/tenants/functions'
import { TenantForm, tenantToInput } from '#/features/tenants/tenant-form'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'

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
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const today = stockholmDate(Date.now())

  const update = useMutation({
    mutationFn: updateTenantFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(tenantQuery(tenantId).queryKey, updated)
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
      await queryClient.invalidateQueries({ queryKey: ['leases'] })
      setEditing(false)
    },
  })
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
        back={{ label: 'Hyresgäster', to: '/tenants' }}
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
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden="true" />
                Redigera uppgifter
              </Button>
              {tenant.leases.length === 0 && can({ lease: ['read'] }) && (
                <MoreActions label={`Fler åtgärder för ${tenant.name}`}>
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden="true" />
                    Ta bort hyresgäst
                  </DropdownMenuItem>
                </MoreActions>
              )}
            </>
          )
        }
      />

      {confirmDelete && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <span className="min-w-0 flex-1">Ta bort {tenant.name}? Det går inte att ångra.</span>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              variant="outline"
              className="h-11 flex-1 sm:h-9"
              onClick={() => setConfirmDelete(false)}
            >
              Avbryt
            </Button>
            <Button
              variant="destructive"
              className="h-11 flex-1 sm:h-9"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ data: { tenantId } })}
            >
              Ta bort
            </Button>
          </div>
          {remove.error && (
            <p className="w-full text-destructive text-sm">{remove.error.message}</p>
          )}
        </section>
      )}

      <StatRow>
        <StatCard
          label="Avtal"
          hint={
            tenant.leases.length > current.length ? `${tenant.leases.length} totalt` : undefined
          }
        >
          {current.length === 0
            ? 'Inga'
            : `${current.length} ${current.length === 1 ? 'aktuellt' : 'aktuella'}`}
        </StatCard>
        <StatCard
          label="Hyra"
          hint={
            running.length === 0 && firstStart
              ? `från ${formatShortDate(firstStart)}`
              : rentLeases.some((l) => l.vat)
                ? 'exkl. moms'
                : undefined
          }
        >
          {formatSekShort(rent)}
          <span className="font-medium text-muted-foreground text-sm"> /mån</span>
        </StatCard>
        {can({ invoice: ['read'] }) && (
          <StatCard
            label="Utestående"
            tone={invoices.overdue.count > 0 ? 'danger' : 'default'}
            hint={
              invoices.overdue.count > 0
                ? `${invoiceCount(invoices.overdue.count)} förfallen`
                : invoices.outstanding.count > 0
                  ? `${invoiceCount(invoices.outstanding.count)} obetald`
                  : 'Inga obetalda avier'
            }
          >
            {formatSekShort(invoices.outstanding.totalOre)}
          </StatCard>
        )}
        <StatCard
          label="Avier"
          hint={tenant.email ? 'skickas med e-post' : 'saknar e-post – skrivs ut'}
          hintClass={tenant.email ? undefined : 'text-amber-700 dark:text-amber-300'}
        >
          {tenant.email ? 'E-post' : 'Utskrift'}
        </StatCard>
      </StatRow>

      <DetailColumns
        main={
          <>
            {can({ lease: ['read'] }) && (
              <Panel title="Avtal">
                {tenant.leases.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">Inga avtal ännu.</p>
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
                            Avtal #{l.number}
                          </Link>
                          <span className="truncate text-muted-foreground tabular-nums">
                            {formatPeriod(l)}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="hidden font-semibold tabular-nums sm:inline">
                            {formatSekShort(l.rentOre)}
                            <span className="font-normal text-muted-foreground">
                              {l.rentInterval === 'monthly' ? ' /mån' : ' /år'}
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
              <Panel title="Senaste avier">
                {tenant.invoices.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">Inga avier ännu.</p>
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
                            {formatSekShort(i.totalOre)}
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
          <Panel title="Kontakt">
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
                Ingen e-post eller telefon.
              </p>
            )}
            <div className="border-t pt-3">
              <FactList
                facts={[
                  ['Typ', tenantKindLabels[tenant.kind]],
                  ...(tenant.organizationNumber
                    ? ([['Org.nr', tenant.organizationNumber]] as const)
                    : []),
                  ['Fakturaadress', address.join(', ') || '–'],
                ]}
              />
            </div>
          </Panel>
        }
      />

      {canManage && (
        <FormDrawer
          open={editing}
          onOpenChange={setEditing}
          title="Redigera uppgifter"
          description="Ändringar gäller nya avier. Redan skapade avier behåller uppgifterna de skapades med."
        >
          <TenantForm
            idPrefix="edit-"
            layout="narrow"
            // Remount with fresh values after a save so the form never shows stale data.
            key={JSON.stringify(tenantToInput(tenant))}
            defaultValues={tenantToInput(tenant)}
            submitLabel="Spara ändringar"
            error={update.error}
            onSubmit={(value) => update.mutateAsync({ data: { tenantId, ...value } })}
          />
        </FormDrawer>
      )}
    </div>
  )
}
