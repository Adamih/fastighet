import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { DeleteButton } from '#/components/delete-button'
import { useCan } from '#/features/auth/use-can'
import { deletePropertyFn, propertyQuery, updatePropertyFn } from '#/features/properties/functions'
import { PropertyForm } from '#/features/properties/property-form'

// `$propertyId_` keeps this page out of the property page's layout.
export const Route = createFileRoute('/_app/properties/$propertyId_/edit')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(propertyQuery(params.propertyId)),
  component: EditPropertyPage,
})

function EditPropertyPage() {
  const { propertyId } = Route.useParams()
  const canManage = useCan()({ property: ['manage'] })
  const { data: property } = useSuspenseQuery(propertyQuery(propertyId))
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const update = useMutation({
    mutationFn: updatePropertyFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      await queryClient.invalidateQueries({ queryKey: ['units'] })
      await navigate({ to: '/properties/$propertyId', params: { propertyId } })
    },
  })
  const remove = useMutation({
    mutationFn: deletePropertyFn,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: propertyQuery(propertyId).queryKey })
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      await queryClient.invalidateQueries({ queryKey: ['units'] })
      await navigate({ to: '/' })
    },
  })
  const leased = property.units.some((u) => u.occupancy)

  return (
    <div className="grid max-w-xl gap-8">
      <div className="grid gap-1">
        <Link
          to="/properties/$propertyId"
          params={{ propertyId }}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {property.designation}
        </Link>
        <h1 className="font-semibold text-2xl">Ändra fastighet</h1>
      </div>

      <PropertyForm
        disabled={!canManage}
        defaultValues={{
          designation: property.designation,
          name: property.name ?? '',
          streetAddress: property.streetAddress ?? '',
          postalCode: property.postalCode ?? '',
          city: property.city ?? '',
        }}
        submitLabel="Spara ändringar"
        error={update.error}
        onSubmit={(value) => update.mutateAsync({ data: { propertyId, ...value } })}
      />

      {canManage && (
        <section className="grid gap-2 border-t pt-6">
          <h2 className="font-medium">Ta bort</h2>
          <p className="text-muted-foreground text-sm">
            {leased
              ? 'Fastigheten har objekt med avtal och kan inte tas bort.'
              : `Fastigheten och dess ${property.units.length} objekt tas bort. Det går inte att ångra.`}
          </p>
          {!leased && (
            <DeleteButton
              label="Ta bort fastighet"
              question={`Ta bort ${property.designation}?`}
              pending={remove.isPending}
              onConfirm={() => remove.mutate({ data: { propertyId } })}
            />
          )}
          {remove.error && <p className="text-destructive text-sm">{remove.error.message}</p>}
        </section>
      )}
    </div>
  )
}
