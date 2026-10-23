import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { formatPeriod, formatRent, LeaseStatusBadge } from '#/features/leases/components'
import { leasesQuery } from '#/features/leases/functions'

export const Route = createFileRoute('/_app/leases/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(leasesQuery()),
  component: LeasesPage,
})

function LeasesPage() {
  const canCreate = useCan()({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const { data: leases } = useSuspenseQuery(leasesQuery())

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl">Avtal</h1>
        {canCreate && (
          <Button asChild>
            <Link to="/leases/new">Nytt avtal</Link>
          </Button>
        )}
      </div>
      {leases.length === 0 ? (
        <p className="text-muted-foreground">Inga avtal ännu.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Nr</th>
              <th className="py-2 font-medium">Hyresgäst</th>
              <th className="py-2 font-medium">Objekt</th>
              <th className="py-2 font-medium">Period</th>
              <th className="py-2 text-right font-medium">Hyra</th>
              <th className="py-2 pl-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {leases.map((lease) => (
              <tr key={lease.id} className="border-b">
                <td className="py-2 tabular-nums">
                  <Link
                    to="/leases/$leaseId"
                    params={{ leaseId: lease.id }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {lease.number}
                  </Link>
                </td>
                <td className="py-2">{lease.tenant.name}</td>
                <td className="py-2">
                  {lease.units.map((u) => `${u.designation} · ${u.label}`).join(', ')}
                </td>
                <td className="py-2 tabular-nums">{formatPeriod(lease)}</td>
                <td className="py-2 text-right tabular-nums">{formatRent(lease)}</td>
                <td className="py-2 pl-4">
                  <LeaseStatusBadge status={lease.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
