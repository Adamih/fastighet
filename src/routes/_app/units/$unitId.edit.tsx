import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { DeleteButton } from '#/components/delete-button'
import {
  deleteUnitFn,
  propertyQuery,
  unitQuery,
  updateUnitFn,
} from '#/features/properties/functions'
import { UnitForm } from '#/features/properties/unit-form'
import { canManageTeam } from '#/features/team/roles'

export const Route = createFileRoute('/_app/units/$unitId/edit')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(unitQuery(params.unitId)),
  component: EditUnitPage,
})

function EditUnitPage() {
  const { unitId } = Route.useParams()
  const { app } = Route.useRouteContext()
  const { data: unit } = useSuspenseQuery(unitQuery(unitId))
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const backToProperty = () =>
    navigate({ to: '/properties/$propertyId', params: { propertyId: unit.propertyId } })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: propertyQuery(unit.propertyId).queryKey })
    await queryClient.invalidateQueries({ queryKey: ['units'] })
    await queryClient.invalidateQueries({ queryKey: ['leases'] })
  }
  const update = useMutation({
    mutationFn: updateUnitFn,
    onSuccess: async () => {
      await refresh()
      await backToProperty()
    },
  })
  const remove = useMutation({
    mutationFn: deleteUnitFn,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: unitQuery(unitId).queryKey })
      await refresh()
      await backToProperty()
    },
  })

  return (
    <div className="grid max-w-xl gap-8">
      <div className="grid gap-1">
        <Link
          to="/properties/$propertyId"
          params={{ propertyId: unit.propertyId }}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {unit.property.designation}
        </Link>
        <h1 className="font-semibold text-2xl">Ändra objekt {unit.label}</h1>
      </div>

      <UnitForm
        defaultValues={{ kind: unit.kind, label: unit.label, areaSqm: unit.areaSqm }}
        submitLabel="Spara ändringar"
        error={update.error}
        onSubmit={(value) => update.mutateAsync({ data: { unitId, ...value } })}
      />

      {canManageTeam(app.organization.role) && (
        <section className="grid gap-2 border-t pt-6">
          <h2 className="font-medium">Ta bort</h2>
          {unit.hasLeases ? (
            <p className="text-muted-foreground text-sm">
              Objektet har avtal och kan inte tas bort.
            </p>
          ) : (
            <DeleteButton
              label="Ta bort objekt"
              question={`Ta bort objekt ${unit.label}?`}
              pending={remove.isPending}
              onConfirm={() => remove.mutate({ data: { unitId } })}
            />
          )}
          {remove.error && <p className="text-destructive text-sm">{remove.error.message}</p>}
        </section>
      )}
    </div>
  )
}
