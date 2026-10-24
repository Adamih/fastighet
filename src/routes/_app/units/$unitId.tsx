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
import { formatShortDate, monthlyRentOre, unitLabel } from '#/features/leases/overview'
import { effectiveEndDate } from '#/features/leases/terms'
import { type UnitState, unitAvailability } from '#/features/properties/availability'
import { unitDetailQuery } from '#/features/properties/functions'
import { unitKindLabels } from '#/features/properties/unit-kinds'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_app/units/$unitId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(unitDetailQuery(params.unitId)),
  component: UnitPage,
})

const areaFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 })

const stateLabels: Record<UnitState, string> = {
  vacant: 'Vakant',
  reserved: 'Kommande avtal',
  rented: 'Uthyrt',
  leaving: 'Uppsagt',
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
  const { data: unit } = useSuspenseQuery(unitDetailQuery(unitId))
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
              <Button variant="outline" className="flex-1 sm:flex-none" asChild>
                <Link to="/units/$unitId/edit" params={{ unitId }}>
                  <Pencil aria-hidden="true" />
                  Ändra
                </Link>
              </Button>
            )}
            {can({ lease: ['manage'], tenant: ['read'], property: ['read'] }) &&
              availability.freeFrom && (
                <Button className="flex-1 sm:flex-none" asChild>
                  <Link to="/leases/new" search={{ unitId }}>
                    <Plus aria-hidden="true" />
                    Nytt avtal
                  </Link>
                </Button>
              )}
          </>
        }
      />

      {canReadLeases && (
        <StatRow>
          <StatCard label="Hyresgäst" hint={current ? `Avtal #${current.number}` : undefined}>
            <span className="block truncate">
              {current ? current.tenant.name : next ? 'Ingen ännu' : 'Ingen'}
            </span>
          </StatCard>
          <StatCard
            label="Hyra"
            hint={current?.vat ? 'exkl. moms' : current ? undefined : 'ingen uthyrning nu'}
          >
            {current ? formatSekShort(monthlyRentOre(current)) : '–'}
            {current && <span className="font-medium text-muted-foreground text-sm"> /mån</span>}
          </StatCard>
          <StatCard
            label="Ledigt från"
            hint={
              availability.freeFrom === today
                ? next
                  ? `till ${formatShortDate(next.startDate)}`
                  : 'kan hyras ut'
                : !availability.freeFrom && next
                  ? `ny hyresgäst ${formatShortDate(next.startDate)}`
                  : undefined
            }
            hintClass={
              availability.freeFrom === today ? 'text-emerald-700 dark:text-emerald-300' : undefined
            }
          >
            {availability.freeFrom === today
              ? 'Nu'
              : availability.freeFrom
                ? formatShortDate(availability.freeFrom)
                : next
                  ? '–'
                  : 'Tillsvidare'}
          </StatCard>
          <StatCard label="Yta">
            {unit.areaSqm != null ? `${areaFormat.format(unit.areaSqm)} m²` : '–'}
          </StatCard>
        </StatRow>
      )}

      <DetailColumns
        main={
          canReadLeases && (
            <>
              {focus && (
                <Panel title={current ? 'Nuvarande avtal' : 'Kommande avtal'}>
                  <LeaseRow lease={focus} />
                  {current && next && (
                    <div className="border-t pt-3">
                      <p className="mb-2 font-medium text-[13px] text-muted-foreground">Därefter</p>
                      <LeaseRow lease={next} />
                    </div>
                  )}
                </Panel>
              )}
              <Panel title="Uthyrningshistorik">
                {unit.leases.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">Objektet har aldrig hyrts ut.</p>
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
                              Avtal #{l.number}
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
          <Panel title="Uppgifter">
            <FactList
              facts={[
                [
                  'Fastighet',
                  <Link
                    key="property"
                    to="/properties/$propertyId"
                    params={{ propertyId: unit.property.id }}
                    className="underline-offset-4 hover:underline"
                  >
                    {unit.property.designation}
                  </Link>,
                ],
                ['Objektsnummer', unit.label],
                ['Typ', unitKindLabels[unit.kind]],
                ['Yta', unit.areaSqm != null ? `${areaFormat.format(unit.areaSqm)} m²` : '–'],
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
          Avtal #{lease.number} · {formatPeriod(lease)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="hidden font-semibold tabular-nums sm:inline">
          {formatSekShort(monthlyRentOre(lease))}
          <span className="font-normal text-muted-foreground"> /mån</span>
        </span>
        <LeaseStatusBadge status={lease.status} />
      </span>
    </div>
  )
}
