import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AddForm } from '#/components/add-form'
import { desktopTableClass, MobileList, RowMeta, RowTitle } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { LeaseStatusBadge } from '#/features/leases/components'
import { createUnitFn, propertyQuery } from '#/features/properties/functions'
import { emptyUnit, UnitForm } from '#/features/properties/unit-form'
import { unitKindLabels } from '#/features/properties/unit-kinds'

export const Route = createFileRoute('/_app/properties/$propertyId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(propertyQuery(params.propertyId)),
  component: PropertyPage,
})

const areaFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 })

function PropertyPage() {
  const can = useCan()
  const canManage = can({ property: ['manage'] })
  const { propertyId } = Route.useParams()
  const { data: property } = useSuspenseQuery(propertyQuery(propertyId))

  return (
    <div className="grid gap-6 sm:gap-8">
      <div className="grid gap-1">
        <Link to="/" className="text-muted-foreground text-sm hover:underline">
          ← Fastigheter
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-start">
          <h1 className="min-w-0 font-semibold text-2xl">{property.designation}</h1>
          {canManage && (
            <Button variant="outline" size="sm" className="h-11 sm:h-8" asChild>
              <Link to="/properties/$propertyId/edit" params={{ propertyId }}>
                Ändra
              </Link>
            </Button>
          )}
        </div>
        {property.name && <p className="text-muted-foreground">{property.name}</p>}
      </div>

      <section className="grid gap-3">
        <h2 className="font-medium text-lg">Objekt</h2>
        {property.units.length === 0 ? (
          <p className="text-muted-foreground">Inga objekt ännu.</p>
        ) : (
          <>
            {/* Rows are not links here: each has its own tenant link and edit button. */}
            <MobileList>
              {property.units.map((u) => (
                <li key={u.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                  <span className="grid min-w-0 flex-1 gap-1">
                    <RowTitle>{u.label}</RowTitle>
                    <RowMeta>
                      {unitKindLabels[u.kind]}
                      {u.areaSqm != null && ` · ${areaFormat.format(u.areaSqm)} m²`}
                    </RowMeta>
                    {can({ lease: ['read'] }) &&
                      (u.occupancy ? (
                        <span className="flex flex-wrap items-center gap-2 text-sm">
                          <Link
                            to="/leases/$leaseId"
                            params={{ leaseId: u.occupancy.leaseId }}
                            className="underline-offset-4 hover:underline"
                          >
                            {u.occupancy.tenantName}
                          </Link>
                          <LeaseStatusBadge status={u.occupancy.status} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Vakant</span>
                      ))}
                  </span>
                  {canManage && (
                    <Button variant="outline" size="sm" className="h-11" asChild>
                      <Link to="/units/$unitId/edit" params={{ unitId: u.id }}>
                        Ändra
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </MobileList>
            <table className={desktopTableClass}>
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Objekt</th>
                  <th className="py-2 font-medium">Typ</th>
                  <th className="py-2 text-right font-medium">Yta</th>
                  {can({ lease: ['read'] }) && <th className="py-2 pl-6 font-medium">Hyresgäst</th>}
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {property.units.map((u) => (
                  <tr key={u.id} className="border-b">
                    <td className="py-2 font-medium">{u.label}</td>
                    <td className="py-2">{unitKindLabels[u.kind]}</td>
                    <td className="py-2 text-right">
                      {u.areaSqm == null ? '–' : `${areaFormat.format(u.areaSqm)} m²`}
                    </td>
                    {can({ lease: ['read'] }) && (
                      <td className="py-2 pl-6">
                        {u.occupancy ? (
                          <span className="flex items-center gap-2">
                            <Link
                              to="/leases/$leaseId"
                              params={{ leaseId: u.occupancy.leaseId }}
                              className="underline-offset-4 hover:underline"
                            >
                              {u.occupancy.tenantName}
                            </Link>
                            <LeaseStatusBadge status={u.occupancy.status} />
                            <span className="text-muted-foreground tabular-nums">
                              {u.occupancy.status === 'upcoming'
                                ? `från ${u.occupancy.startDate}`
                                : u.occupancy.moveOutDate && `till ${u.occupancy.moveOutDate}`}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Vakant</span>
                        )}
                      </td>
                    )}
                    <td className="py-2 text-right">
                      {canManage && (
                        <Link
                          to="/units/$unitId/edit"
                          params={{ unitId: u.id }}
                          className="text-muted-foreground underline-offset-4 hover:underline"
                        >
                          Ändra
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {canManage && <CreateUnit propertyId={propertyId} />}
    </div>
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
