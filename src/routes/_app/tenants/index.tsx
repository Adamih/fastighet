import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  desktopTableClass,
  MobileList,
  MobileListLink,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
import { useCan } from '#/features/auth/use-can'
import { tenantKindLabels } from '#/features/leases/options'
import { createTenantFn, tenantsQuery } from '#/features/tenants/functions'
import { emptyTenant, TenantForm } from '#/features/tenants/tenant-form'

export const Route = createFileRoute('/_app/tenants/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(tenantsQuery()),
  component: TenantsPage,
})

function TenantsPage() {
  const canManage = useCan()({ tenant: ['manage'] })
  const { data: tenants } = useSuspenseQuery(tenantsQuery())
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createTenantFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantsQuery().queryKey }),
  })

  return (
    <div className="grid gap-6 sm:gap-8">
      <PageHeader
        title="Hyresgäster"
        subtitle={tenants.length > 0 && `${tenants.length} hyresgäster`}
      />
      {tenants.length === 0 ? (
        <p className="text-muted-foreground">Inga hyresgäster ännu.</p>
      ) : (
        <>
          <MobileList>
            {tenants.map((t) => (
              <li key={t.id}>
                <MobileListLink to="/tenants/$tenantId" params={{ tenantId: t.id }}>
                  <RowTitle>{t.name}</RowTitle>
                  <RowMeta>
                    {t.kind === 'company'
                      ? [tenantKindLabels.company, t.organizationNumber].filter(Boolean).join(' · ')
                      : t.email || t.phone || 'Saknar e-post'}
                  </RowMeta>
                </MobileListLink>
              </li>
            ))}
          </MobileList>
          <table className={desktopTableClass}>
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Namn</th>
                <th className="py-2 font-medium">Typ</th>
                <th className="py-2 font-medium">Org.nr</th>
                <th className="py-2 font-medium">E-post</th>
                <th className="py-2 font-medium">Telefon</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2">
                    <Link
                      to="/tenants/$tenantId"
                      params={{ tenantId: t.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="py-2">{tenantKindLabels[t.kind]}</td>
                  <td className="py-2 tabular-nums">{t.organizationNumber}</td>
                  <td className="py-2">{t.email}</td>
                  <td className="py-2">{t.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {canManage && (
        <section className="grid max-w-xl gap-4 rounded-lg border p-4 sm:p-6">
          <h2 className="font-medium text-lg">Lägg till hyresgäst</h2>
          <TenantForm
            defaultValues={emptyTenant}
            submitLabel="Spara"
            error={create.error}
            resetAfterSubmit
            onSubmit={(value) => create.mutateAsync({ data: value })}
          />
        </section>
      )}
    </div>
  )
}
