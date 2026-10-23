import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { DeleteButton } from '#/components/delete-button'
import { useCan } from '#/features/auth/use-can'
import { formatPeriod, formatRent, LeaseStatusBadge } from '#/features/leases/components'
import { tenantKindLabels } from '#/features/leases/options'
import { deleteTenantFn, tenantQuery, updateTenantFn } from '#/features/tenants/functions'
import { TenantForm, tenantToInput } from '#/features/tenants/tenant-form'

export const Route = createFileRoute('/_app/tenants/$tenantId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(tenantQuery(params.tenantId)),
  component: TenantPage,
})

function TenantPage() {
  const { tenantId } = Route.useParams()
  const canManage = useCan()({ tenant: ['manage'] })
  const { data: tenant } = useSuspenseQuery(tenantQuery(tenantId))
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)

  const update = useMutation({
    mutationFn: updateTenantFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(tenantQuery(tenantId).queryKey, updated)
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
      await queryClient.invalidateQueries({ queryKey: ['leases'] })
      setSaved(true)
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

  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <Link to="/tenants" className="text-muted-foreground text-sm hover:underline">
          ← Hyresgäster
        </Link>
        <h1 className="font-semibold text-2xl">{tenant.name}</h1>
        <p className="text-muted-foreground">{tenantKindLabels[tenant.kind]}</p>
      </div>

      <section className="grid gap-3">
        <h2 className="font-medium text-lg">Avtal</h2>
        {tenant.leases.length === 0 ? (
          <p className="text-muted-foreground">Inga avtal.</p>
        ) : (
          <table className="w-full max-w-3xl text-left text-sm">
            <tbody>
              {tenant.leases.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="py-2 tabular-nums">
                    <Link
                      to="/leases/$leaseId"
                      params={{ leaseId: l.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      Avtal {l.number}
                    </Link>
                  </td>
                  <td className="py-2 tabular-nums">{formatPeriod(l)}</td>
                  <td className="py-2 text-right tabular-nums">{formatRent(l)}</td>
                  <td className="py-2 pl-4">
                    <LeaseStatusBadge status={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid max-w-xl gap-4 rounded-lg border p-6">
        <h2 className="font-medium text-lg">Uppgifter</h2>
        <p className="text-muted-foreground text-sm">
          Ändringar gäller nya avier. Redan skapade avier behåller uppgifterna de skapades med.
        </p>
        <TenantForm
          // Remount with fresh values after a save so the form never shows stale data.
          key={JSON.stringify(tenantToInput(tenant))}
          defaultValues={tenantToInput(tenant)}
          submitLabel="Spara ändringar"
          error={update.error}
          onSubmit={(value) => {
            setSaved(false)
            return update.mutateAsync({ data: { tenantId, ...value } })
          }}
        />
        {saved && <p className="text-emerald-700 text-sm dark:text-emerald-300">Sparat.</p>}
      </section>

      {canManage && (
        <section className="grid max-w-xl gap-2">
          {tenant.leases.length > 0 ? (
            <p className="text-muted-foreground text-sm">
              En hyresgäst med avtal kan inte tas bort.
            </p>
          ) : (
            <DeleteButton
              label="Ta bort hyresgäst"
              question={`Ta bort ${tenant.name}?`}
              pending={remove.isPending}
              onConfirm={() => remove.mutate({ data: { tenantId } })}
            />
          )}
          {remove.error && <p className="text-destructive text-sm">{remove.error.message}</p>}
        </section>
      )}
    </div>
  )
}
