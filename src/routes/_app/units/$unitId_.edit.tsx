import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { DeleteButton } from '#/components/delete-button'
import { useCan } from '#/features/auth/use-can'
import {
  deleteUnitFn,
  propertyQuery,
  unitQuery,
  updateUnitFn,
} from '#/features/properties/functions'
import { UnitForm } from '#/features/properties/unit-form'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/units/$unitId_/edit')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(unitQuery(params.unitId)),
  component: EditUnitPage,
})

function EditUnitPage() {
  const { unitId } = Route.useParams()
  const canManage = useCan()({ property: ['manage'] })
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
      await navigate({ to: '/units/$unitId', params: { unitId } })
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
          to="/units/$unitId"
          params={{ unitId }}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {m.unit_named({ label: unit.label })}
        </Link>
        <h1 className="font-semibold text-2xl">{m.unit_edit_title({ label: unit.label })}</h1>
      </div>

      <UnitForm
        disabled={!canManage}
        defaultValues={{ kind: unit.kind, label: unit.label, areaSqm: unit.areaSqm }}
        submitLabel={m.common_save_changes()}
        error={update.error}
        onSubmit={(value) => update.mutateAsync({ data: { unitId, ...value } })}
      />

      {canManage && (
        <section className="grid gap-2 border-t pt-6">
          <h2 className="font-medium">{m.common_delete()}</h2>
          {unit.hasLeases ? (
            <p className="text-muted-foreground text-sm">{m.unit_delete_blocked()}</p>
          ) : (
            <DeleteButton
              label={m.unit_delete()}
              question={m.unit_delete_confirm({ label: unit.label })}
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
