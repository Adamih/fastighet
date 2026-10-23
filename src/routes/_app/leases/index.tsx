import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  desktopTableClass,
  MobileList,
  MobileListLink,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
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
    <div className="grid gap-6 sm:gap-8">
      <PageHeader
        title="Avtal"
        subtitle={leases.length > 0 && `${leases.length} avtal`}
        action={
          canCreate && (
            <Button asChild className="h-11 sm:h-9">
              <Link to="/leases/new">Nytt avtal</Link>
            </Button>
          )
        }
      />
      {leases.length === 0 ? (
        <p className="text-muted-foreground">Inga avtal ännu.</p>
      ) : (
        <>
          <MobileList>
            {leases.map((lease) => (
              <li key={lease.id}>
                <MobileListLink to="/leases/$leaseId" params={{ leaseId: lease.id }}>
                  <RowTitle end={<LeaseStatusBadge status={lease.status} />}>
                    {lease.tenant.name}
                  </RowTitle>
                  <RowMeta>
                    Avtal {lease.number} ·{' '}
                    {lease.units.map((u) => `${u.designation} · ${u.label}`).join(', ')}
                  </RowMeta>
                  <span className="flex flex-wrap justify-between gap-x-3 text-sm tabular-nums">
                    <span className="text-muted-foreground">{formatPeriod(lease)}</span>
                    <span className="font-medium">{formatRent(lease)}</span>
                  </span>
                </MobileListLink>
              </li>
            ))}
          </MobileList>
          <table className={desktopTableClass}>
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
        </>
      )}
    </div>
  )
}
