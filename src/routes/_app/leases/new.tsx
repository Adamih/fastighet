import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCan } from '#/features/auth/use-can'
import { createLeaseFn, leasesQuery } from '#/features/leases/functions'
import { emptyLease, LeaseForm } from '#/features/leases/lease-form'
import { unitsQuery } from '#/features/properties/functions'
import { tenantsQuery } from '#/features/tenants/functions'

export const Route = createFileRoute('/_app/leases/new')({
  // `unitId` preselects a unit, e.g. from the unit page's "Nytt avtal".
  validateSearch: (search): { unitId?: string } => ({
    unitId: typeof search.unitId === 'string' ? search.unitId : undefined,
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(tenantsQuery()),
      context.queryClient.ensureQueryData(unitsQuery()),
    ]),
  component: NewLeasePage,
})

function NewLeasePage() {
  const canCreate = useCan()({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const { data: tenants } = useSuspenseQuery(tenantsQuery())
  const { data: units } = useSuspenseQuery(unitsQuery())
  const { unitId } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: createLeaseFn,
    onSuccess: async (lease) => {
      await queryClient.invalidateQueries({ queryKey: leasesQuery().queryKey })
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
      await navigate({ to: '/leases/$leaseId', params: { leaseId: lease.id } })
    },
  })

  if (!canCreate) return <p>Du saknar behörighet att skapa avtal.</p>

  if (tenants.length === 0 || units.length === 0) {
    return (
      <div className="grid gap-4">
        <h1 className="font-semibold text-2xl">Nytt avtal</h1>
        <p className="text-muted-foreground">
          Ett avtal behöver en hyresgäst och minst ett objekt.{' '}
          {tenants.length === 0 ? (
            <Link to="/tenants" className="underline">
              Lägg till en hyresgäst
            </Link>
          ) : (
            <Link to="/" className="underline">
              Lägg till objekt på en fastighet
            </Link>
          )}{' '}
          först.
        </p>
      </div>
    )
  }

  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="font-semibold text-2xl">Nytt avtal</h1>
      <LeaseForm
        tenants={tenants}
        units={units}
        defaultValues={{
          ...emptyLease,
          unitIds: unitId && units.some((u) => u.id === unitId) ? [unitId] : [],
        }}
        submitLabel="Skapa avtal"
        error={create.error}
        onSubmit={(value) => create.mutateAsync({ data: value })}
      />
    </div>
  )
}
