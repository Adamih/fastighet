import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { LeaseStatusBadge } from '#/features/leases/components'
import { formatShortDate } from '#/features/leases/overview'
import { agreementKindLabels } from '#/features/portal/agreement-labels'
import { portalAgreementsQuery } from '#/features/portal/portal-functions'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/portal/_portal/avtal/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(portalAgreementsQuery()),
  component: PortalAgreementsPage,
})

function PortalAgreementsPage() {
  const { data: agreements } = useSuspenseQuery(portalAgreementsQuery())
  return (
    <div className="grid gap-5">
      <h1 className="font-bold text-2xl tracking-tight md:text-3xl">{m.portal_nav_agreements()}</h1>
      <section className="rounded-xl border bg-card px-3 py-1">
        {agreements.length === 0 ? (
          <p className="py-4 text-muted-foreground text-sm">{m.portal_agreements_none()}</p>
        ) : (
          agreements.map((a) => (
            <Link
              key={a.id}
              to="/portal/avtal/$agreementId"
              params={{ agreementId: a.id }}
              className="flex min-h-16 items-center justify-between gap-3 border-t px-1 py-3 first:border-t-0 hover:bg-accent/50"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate font-semibold">
                  {agreementKindLabels[a.kind]()} {a.number}
                </span>
                <span className="truncate text-muted-foreground text-sm">
                  {a.units.map((u) => `${u.address ?? u.designation} · ${u.label}`).join(', ')}
                  {' · '}
                  {m.portal_agreement_from({ date: formatShortDate(a.startDate) })}
                </span>
              </span>
              <span className="grid shrink-0 justify-items-end gap-1">
                <span className="font-semibold tabular-nums">
                  {formatSek(a.rentOre)}
                  <span className="font-normal text-muted-foreground text-xs">
                    {' '}
                    {a.rentInterval === 'yearly' ? m.common_per_year() : m.common_per_month()}
                  </span>
                </span>
                <LeaseStatusBadge status={a.status} />
              </span>
            </Link>
          ))
        )}
      </section>
    </div>
  )
}
