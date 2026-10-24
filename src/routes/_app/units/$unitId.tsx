import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Pencil, Plus } from 'lucide-react'
import {
  DetailColumns,
  DetailHeader,
  FactList,
  Panel,
  PanelRow,
  StatRow,
} from '#/components/detail'
import { StatCard } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { formatPeriod, LeaseStatusBadge } from '#/features/leases/components'
import { useAddLeaseDrawer } from '#/features/leases/lease-form'
import { formatShortDate, monthlyRentOre, unitLabel } from '#/features/leases/overview'
import { effectiveEndDate } from '#/features/leases/terms'
import { type UnitState, unitAvailability } from '#/features/properties/availability'
import { unitDetailQuery } from '#/features/properties/functions'
import { useEditUnitDrawer } from '#/features/properties/unit-form'
import { unitKindLabels } from '#/features/properties/unit-kinds'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/units/$unitId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(unitDetailQuery(params.unitId)),
  component: UnitPage,
})

const areaFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 })

const stateLabels: Record<UnitState, string> = {
  get vacant() {
    return m.unit_vacant()
  },
  get reserved() {
    return m.unit_upcoming_lease()
  },
  get rented() {
    return m.unit_rented()
  },
  get leaving() {
    return m.lease_status_terminated()
  },
}
const stateStyles: Record<UnitState, string> = {
  vacant: 'bg-muted text-muted-foreground',
  reserved: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  rented: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  leaving: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
}

function UnitPage() {
  const { unitId } = Route.useParams()
  const can = useCan()
  const canReadLeases = can({ lease: ['read'] })
  const canCreateLease = can({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const addLease = useAddLeaseDrawer(unitId)
  const { data: unit } = useSuspenseQuery(unitDetailQuery(unitId))
  const edit = useEditUnitDrawer(unit)
  const today = stockholmDate(Date.now())
  const availability = unitAvailability(unit.leases, today)
  const { current, next } = availability
  const focus = current ?? next
  const title = unitLabel(unit)

  return (
    <div className="grid gap-6 md:gap-7">
      <DetailHeader
        back={{
          label: unit.property.designation,
          to: '/properties/$propertyId',
          params: { propertyId: unit.property.id },
        }}
        crumb={title}
        title={title}
        badge={
          canReadLeases && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold text-xs',
                stateStyles[availability.state],
              )}
            >
              {stateLabels[availability.state]}
            </span>
          )
        }
        meta={[
          unit.property.designation,
          unitKindLabels[unit.kind],
          unit.areaSqm != null && `${areaFormat.format(unit.areaSqm)} m²`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {can({ property: ['manage'] }) && (
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={edit.open}>
                <Pencil aria-hidden="true" />
                {m.common_edit()}
              </Button>
            )}
            {canCreateLease && availability.freeFrom && (
              <Button className="flex-1 sm:flex-none" onClick={addLease.open}>
                <Plus aria-hidden="true" />
                {m.lease_new()}
              </Button>
            )}
          </>
        }
      />

      {canReadLeases && (
        <StatRow>
          <StatCard
            label={m.lease_form_tenant()}
            hint={current ? m.lease_number({ number: current.number }) : undefined}
          >
            <span className="block truncate">
              {current ? current.tenant.name : next ? m.unit_no_tenant_yet() : m.unit_no_tenant()}
            </span>
          </StatCard>
          <StatCard
            label={m.common_rent()}
            hint={
              current?.vat ? m.common_excl_vat() : current ? undefined : m.unit_not_rented_now()
            }
          >
            {current ? formatSekShort(monthlyRentOre(current)) : '–'}
            {current && (
              <span className="font-medium text-muted-foreground text-sm">
                {' '}
                {m.common_per_month()}
              </span>
            )}
          </StatCard>
          <StatCard
            label={m.unit_available_from()}
            hint={
              availability.freeFrom === today
                ? next
                  ? m.common_until_date({ date: formatShortDate(next.startDate) })
                  : m.unit_can_be_rented()
                : !availability.freeFrom && next
                  ? m.unit_next_tenant({ date: formatShortDate(next.startDate) })
                  : undefined
            }
            hintClass={
              availability.freeFrom === today ? 'text-emerald-700 dark:text-emerald-300' : undefined
            }
          >
            {availability.freeFrom === today
              ? m.unit_available_now()
              : availability.freeFrom
                ? formatShortDate(availability.freeFrom)
                : next
                  ? '–'
                  : m.lease_open_ended()}
          </StatCard>
          <StatCard label={m.unit_area()}>
            {unit.areaSqm != null ? `${areaFormat.format(unit.areaSqm)} m²` : '–'}
          </StatCard>
        </StatRow>
      )}

      <DetailColumns
        main={
          canReadLeases && (
            <>
              {focus && (
                <Panel title={current ? m.unit_current_lease() : m.unit_upcoming_lease()}>
                  <LeaseRow lease={focus} />
                  {current && next && (
                    <div className="border-t pt-3">
                      <p className="mb-2 font-medium text-[13px] text-muted-foreground">
                        {m.unit_afterwards()}
                      </p>
                      <LeaseRow lease={next} />
                    </div>
                  )}
                </Panel>
              )}
              <Panel title={m.unit_rental_history()}>
                {unit.leases.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">{m.unit_never_rented()}</p>
                ) : (
                  <ol>
                    {unit.leases.map((l) => (
                      <li key={l.id}>
                        <PanelRow>
                          <span className="grid min-w-0 gap-0.5">
                            <Link
                              to="/leases/$leaseId"
                              params={{ leaseId: l.id }}
                              className="truncate font-semibold underline-offset-4 hover:underline"
                            >
                              {l.tenant.name}
                            </Link>
                            <span className="truncate text-muted-foreground tabular-nums">
                              {l.startDate.slice(0, 4)}–{(effectiveEndDate(l) ?? '').slice(0, 4)} ·
                              {m.lease_number({ number: l.number })}
                            </span>
                          </span>
                          <LeaseStatusBadge status={l.status} />
                        </PanelRow>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </>
          )
        }
        side={
          <Panel title={m.property_details()}>
            <FactList
              facts={[
                [
                  m.unit_property(),
                  <Link
                    key="property"
                    to="/properties/$propertyId"
                    params={{ propertyId: unit.property.id }}
                    className="underline-offset-4 hover:underline"
                  >
                    {unit.property.designation}
                  </Link>,
                ],
                [m.unit_form_label(), unit.label],
                [m.common_kind(), unitKindLabels[unit.kind]],
                [
                  m.unit_area(),
                  unit.areaSqm != null ? `${areaFormat.format(unit.areaSqm)} m²` : '–',
                ],
              ]}
            />
          </Panel>
        }
      />
    </div>
  )
}

type UnitLease = (typeof Route.types.loaderData)['leases'][number]

function LeaseRow({ lease }: { lease: UnitLease }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="grid min-w-0 gap-0.5">
        <Link
          to="/leases/$leaseId"
          params={{ leaseId: lease.id }}
          className="truncate font-semibold underline-offset-4 hover:underline"
        >
          {lease.tenant.name}
        </Link>
        <span className="truncate text-muted-foreground tabular-nums">
          {m.unit_lease_period({ number: lease.number, period: formatPeriod(lease) })}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="hidden font-semibold tabular-nums sm:inline">
          {formatSekShort(monthlyRentOre(lease))}
          <span className="font-normal text-muted-foreground"> {m.common_per_month()}</span>
        </span>
        <LeaseStatusBadge status={lease.status} />
      </span>
    </div>
  )
}
