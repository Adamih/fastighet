import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { DeleteButton } from '#/components/delete-button'
import { useCan } from '#/features/auth/use-can'
import { deleteLeaseFn, leaseQuery, updateLeaseFn } from '#/features/leases/functions'
import { LeaseForm } from '#/features/leases/lease-form'
import { unitsQuery } from '#/features/properties/functions'
import { m } from '#/paraglide/messages'

// `$leaseId_` keeps this page out of the lease page's layout.
export const Route = createFileRoute('/_app/leases/$leaseId_/edit')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(leaseQuery(params.leaseId)),
      context.queryClient.ensureQueryData(unitsQuery()),
    ]),
  component: EditLeasePage,
})

function EditLeasePage() {
  const { leaseId } = Route.useParams()
  const canManage = useCan()({ lease: ['manage'] })
  const { data: lease } = useSuspenseQuery(leaseQuery(leaseId))
  const { data: units } = useSuspenseQuery(unitsQuery())
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['leases'] })
    await queryClient.invalidateQueries({ queryKey: ['properties'] })
    await queryClient.invalidateQueries({ queryKey: ['tenants'] })
  }
  const update = useMutation({
    mutationFn: updateLeaseFn,
    onSuccess: async () => {
      await refresh()
      await navigate({ to: '/leases/$leaseId', params: { leaseId } })
    },
  })
  const remove = useMutation({
    mutationFn: deleteLeaseFn,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: leaseQuery(leaseId).queryKey })
      await refresh()
      await navigate({ to: '/leases' })
    },
  })

  return (
    <div className="grid max-w-2xl gap-8">
      <div className="grid gap-1">
        <Link
          to="/leases/$leaseId"
          params={{ leaseId }}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {m.lease_number({ number: lease.number })}
        </Link>
        <h1 className="font-semibold text-2xl">{m.lease_edit_title({ number: lease.number })}</h1>
        <p className="text-muted-foreground">{m.lease_edit_intro({ tenant: lease.tenant.name })}</p>
      </div>

      <LeaseForm
        disabled={!canManage}
        units={units}
        defaultValues={{
          tenantId: lease.tenant.id,
          unitIds: lease.units.map((u) => u.id),
          startDate: lease.startDate,
          endDate: lease.endDate,
          extensionMonths: lease.extensionMonths,
          noticePeriodMonths: lease.noticePeriodMonths,
          rentOre: lease.rentOre,
          rentInterval: lease.rentInterval,
          invoiceInterval: lease.invoiceInterval,
          vat: lease.vat,
        }}
        submitLabel={m.common_save_changes()}
        error={update.error}
        onSubmit={({ tenantId: _tenantId, ...value }) =>
          update.mutateAsync({ data: { leaseId, ...value } })
        }
      />

      {canManage && (
        <section className="grid gap-2 border-t pt-6">
          <h2 className="font-medium">{m.common_delete()}</h2>
          <p className="text-muted-foreground text-sm">{m.lease_delete_rule()}</p>
          <DeleteButton
            label={m.lease_delete()}
            question={m.lease_delete_confirm({ number: lease.number })}
            pending={remove.isPending}
            onConfirm={() => remove.mutate({ data: { leaseId } })}
          />
          {remove.error && <p className="text-destructive text-sm">{remove.error.message}</p>}
        </section>
      )}
    </div>
  )
}
