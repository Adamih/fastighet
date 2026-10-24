import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronRight, Pencil } from 'lucide-react'
import { AddForm } from '#/components/add-form'
import { DetailColumns, DetailHeader, FactList, Panel, StatRow } from '#/components/detail'
import { StatCard } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { LeaseStatusBadge } from '#/features/leases/components'
import { monthlyRentOre, unitLabel } from '#/features/leases/overview'
import { createUnitFn, propertyQuery } from '#/features/properties/functions'
import { propertySummary } from '#/features/properties/summary'
import { emptyUnit, UnitForm } from '#/features/properties/unit-form'
import { unitKindLabels } from '#/features/properties/unit-kinds'
import { formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_app/properties/$propertyId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(propertyQuery(params.propertyId)),
  component: PropertyPage,
})

const areaFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 })

type Unit = (typeof Route.types.loaderData)['units'][number]

function PropertyPage() {
  const can = useCan()
  const canManage = can({ property: ['manage'] })
  const canReadLeases = can({ lease: ['read'] })
  const { propertyId } = Route.useParams()
  const { data: property } = useSuspenseQuery(propertyQuery(propertyId))
  const summary = propertySummary(property.units)
  const address = [
    property.streetAddress,
    [property.postalCode, property.city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
  const occupancyShare = summary.units > 0 ? summary.rented / summary.units : 0

  return (
    <div className={cn('grid gap-6 md:gap-7', canManage && 'pb-20 md:pb-0')}>
      <DetailHeader
        back={{ label: 'Fastigheter', to: '/' }}
        crumb={property.designation}
        title={property.designation}
        meta={[property.name, address].filter(Boolean).join(' · ') || undefined}
        actions={
          canManage && (
            <>
              <Button variant="outline" className="flex-1 sm:flex-none" asChild>
                <Link to="/properties/$propertyId/edit" params={{ propertyId }}>
                  <Pencil aria-hidden="true" />
                  Ändra
                </Link>
              </Button>
              <CreateUnit propertyId={propertyId} />
            </>
          )
        }
      />

      <StatRow>
        <StatCard label="Objekt">{summary.units}</StatCard>
        {canReadLeases ? (
          <>
            <StatCard
              label="Uthyrt"
              hint={
                <span
                  role="img"
                  aria-label={`${Math.round(occupancyShare * 100)} % uthyrt`}
                  className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="block h-1.5 rounded-full bg-emerald-600"
                    style={{ width: `${Math.round(occupancyShare * 100)}%` }}
                  />
                </span>
              }
            >
              {summary.rented} av {summary.units}
            </StatCard>
            <StatCard label="Hyra" hint={summary.vat ? 'exkl. moms' : 'gällande avtal'}>
              {formatSekShort(summary.monthlyRentOre)}
              <span className="font-medium text-muted-foreground text-sm"> /mån</span>
            </StatCard>
          </>
        ) : (
          <StatCard label="Ort">{property.city ?? '–'}</StatCard>
        )}
        <StatCard label="Yta">
          {summary.areaSqm > 0 ? `${areaFormat.format(summary.areaSqm)} m²` : '–'}
        </StatCard>
      </StatRow>

      <DetailColumns
        main={
          <section aria-labelledby="units" className="overflow-hidden rounded-xl border bg-card">
            <h2 id="units" className="border-b px-4 py-3 font-semibold text-[15px] md:px-5">
              Objekt{' '}
              <span className="font-medium text-muted-foreground tabular-nums">
                {property.units.length}
              </span>
            </h2>
            {property.units.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-muted-foreground md:px-5">
                Inga objekt ännu.
              </p>
            ) : (
              <ul className="divide-y">
                {property.units.map((u) => (
                  <UnitRow
                    key={u.id}
                    unit={u}
                    showOccupancy={canReadLeases}
                    shared={
                      !!u.occupancy &&
                      property.units.filter((o) => o.occupancy?.leaseId === u.occupancy?.leaseId)
                        .length > 1
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        }
        side={
          <Panel title="Uppgifter">
            <FactList
              facts={[
                ['Beteckning', property.designation],
                ['Namn', property.name ?? '–'],
                ['Adress', address || '–'],
              ]}
            />
          </Panel>
        }
      />
    </div>
  )
}

/** One unit: label and size on the left, who rents it on the right. Opens the unit page. */
function UnitRow({
  unit,
  showOccupancy,
  shared,
}: {
  unit: Unit
  showOccupancy: boolean
  /** The lease also covers other units here, so its rent isn't this unit's alone. */
  shared: boolean
}) {
  const o = unit.occupancy
  return (
    <li>
      <Link
        to="/units/$unitId"
        params={{ unitId: unit.id }}
        className="flex min-h-14 items-center gap-3 px-4 py-3 text-[13px] text-foreground hover:bg-muted/40 hover:text-foreground md:px-5"
      >
        <span className="grid min-w-0 flex-1 gap-1.5 sm:flex sm:items-center sm:justify-between sm:gap-3">
          <span className="grid min-w-0 gap-0.5">
            <span className="font-semibold text-sm">{unitLabel(unit)}</span>
            <span className="truncate text-muted-foreground">
              {[
                unitKindLabels[unit.kind],
                unit.areaSqm != null && `${areaFormat.format(unit.areaSqm)} m²`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          {showOccupancy &&
            (o ? (
              <span className="grid min-w-0 gap-0.5 sm:justify-items-end sm:text-right">
                <span className="flex min-w-0 items-center gap-2 sm:flex-row-reverse">
                  <LeaseStatusBadge status={o.status} />
                  <span className="truncate">{o.tenantName}</span>
                </span>
                <span className="truncate text-muted-foreground tabular-nums">
                  {o.status === 'upcoming'
                    ? `från ${o.startDate}`
                    : o.moveOutDate
                      ? `till ${o.moveOutDate}`
                      : shared
                        ? `Avtal #${o.number}, flera objekt`
                        : `${formatSekShort(monthlyRentOre(o))} /mån`}
                </span>
              </span>
            ) : (
              <span className="justify-self-start rounded-full bg-muted px-2.5 py-0.5 font-semibold text-muted-foreground text-xs">
                Vakant
              </span>
            ))}
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

function CreateUnit({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createUnitFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: propertyQuery(propertyId).queryKey })
      await queryClient.invalidateQueries({ queryKey: ['units'] })
    },
  })

  return (
    <AddForm title="Lägg till objekt" description="Lägenheter, lokaler, parkeringar och förråd.">
      {({ idPrefix, layout, onSaved }) => (
        <UnitForm
          idPrefix={idPrefix}
          layout={layout}
          defaultValues={emptyUnit}
          submitLabel="Spara objekt"
          error={create.error}
          resetAfterSubmit
          onSubmit={async (value) => {
            await create.mutateAsync({ data: { propertyId, ...value } })
            onSaved()
          }}
        />
      )}
    </AddForm>
  )
}
