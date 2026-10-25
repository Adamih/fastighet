import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import {
  desktopTableClass,
  FilterChips,
  filterChipClass,
  MobileList,
  MobileListLink,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { LeaseStatusBadge } from '#/features/leases/components'
import { unitSummary } from '#/features/leases/overview'
import { ownershipsQuery } from '#/features/ownerships/functions'
import { ownershipStatusLabels } from '#/features/ownerships/labels'
import { useAddOwnershipDrawer } from '#/features/ownerships/ownership-form'
import type { OwnershipView } from '#/features/ownerships/program'
import { formatShareRatio } from '#/features/ownerships/rules'
import { formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

const filters = ['all', 'active', 'ended'] as const
type Filter = (typeof filters)[number]
const filterLabels: Record<Filter, string> = {
  get all() {
    return m.filter_all()
  },
  get active() {
    return m.ownership_filter_active()
  },
  get ended() {
    return m.ownership_filter_ended()
  },
}

/** "Aktiva" includes upcoming ones and those being sold; "Överlåtna" are the sellers' history. */
const matches = (o: OwnershipView, filter: Filter) =>
  filter === 'all' || (filter === 'ended' ? o.status === 'ended' : o.status !== 'ended')

export const Route = createFileRoute('/_app/ownerships/')({
  validateSearch: (search): { filter?: Filter } => ({
    filter: filters.includes(search.filter as Filter) ? (search.filter as Filter) : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(ownershipsQuery()),
  component: OwnershipsPage,
})

const th = 'whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground text-xs'
const td = 'px-3 py-3'

function OwnershipsPage() {
  const canCreate = useCan()({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const add = useAddOwnershipDrawer()
  const { data: ownerships } = useSuspenseQuery(ownershipsQuery())
  const filter = Route.useSearch().filter ?? 'all'
  const visible = ownerships.filter((o) => matches(o, filter))
  const counts = Object.fromEntries(
    filters.map((f) => [f, ownerships.filter((o) => matches(o, f)).length]),
  ) as Record<Filter, number>
  const unitsOf = (o: OwnershipView) => {
    const units = unitSummary(o.units)
    return [units.designations, units.labels.join(', ')].filter(Boolean).join(' · ')
  }

  return (
    <div className={cn('grid gap-5 md:gap-7', canCreate && 'pb-20 md:pb-0')}>
      <PageHeader
        title={m.nav_ownerships()}
        subtitle={
          ownerships.length > 0
            ? m.ownership_count({ count: counts.active })
            : m.ownership_list_subtitle()
        }
        action={
          canCreate && (
            <Button size="fab" onClick={add.open}>
              <Plus aria-hidden="true" />
              <span className="sr-only md:not-sr-only">{m.ownership_add()}</span>
            </Button>
          )
        }
      />

      {ownerships.length === 0 ? (
        <p className="text-muted-foreground">{m.ownership_list_empty()}</p>
      ) : (
        <>
          <FilterChips label={m.ownership_filter_label()}>
            {filters.map((f) => (
              <Link
                key={f}
                to="/ownerships"
                search={f === 'all' ? {} : { filter: f }}
                aria-current={f === filter ? 'page' : undefined}
                className={filterChipClass(f === filter)}
              >
                {filterLabels[f]} <span className="tabular-nums">{counts[f]}</span>
              </Link>
            ))}
          </FilterChips>

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm">{m.ownership_list_no_match()}</p>
          ) : (
            <>
              <table className={cn(desktopTableClass, 'overflow-hidden rounded-xl border bg-card')}>
                <thead>
                  <tr className="border-b">
                    <th className={cn(th, 'w-0')}>{m.invoice_number_short()}</th>
                    <th className={th}>{m.ownership_owners()}</th>
                    <th className={th}>{m.ownership_units()}</th>
                    <th className={cn(th, 'text-right')}>{m.ownership_share_ratio_label()}</th>
                    <th className={cn(th, 'text-right')}>{m.ownership_fee_label()}</th>
                    <th className={th}>{m.common_status()}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((o) => (
                    <tr key={o.id} className="border-b last:border-b-0">
                      <td className={cn(td, 'text-muted-foreground tabular-nums')}>{o.number}</td>
                      <td className={td}>
                        <Link
                          to="/ownerships/$ownershipId"
                          params={{ ownershipId: o.id }}
                          className="font-semibold underline-offset-4 hover:underline"
                        >
                          {o.ownerNames}
                        </Link>
                      </td>
                      <td className={cn(td, 'text-muted-foreground')}>{unitsOf(o)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>
                        {o.shareRatio === null ? '–' : formatShareRatio(o.shareRatio)}
                      </td>
                      <td
                        className={cn(
                          td,
                          'whitespace-nowrap text-right font-semibold tabular-nums',
                        )}
                      >
                        {formatSekShort(o.rentOre)}
                      </td>
                      <td className={td}>
                        <LeaseStatusBadge
                          status={o.status}
                          label={ownershipStatusLabels[o.status]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <MobileList>
                {visible.map((o) => (
                  <li key={o.id}>
                    <MobileListLink to="/ownerships/$ownershipId" params={{ ownershipId: o.id }}>
                      <span className="grid min-w-0 flex-1 gap-1">
                        <RowTitle
                          end={
                            <span className="font-semibold tabular-nums">
                              {formatSekShort(o.rentOre)}
                            </span>
                          }
                        >
                          {o.ownerNames}
                        </RowTitle>
                        <RowMeta>
                          {m.ownership_number({ number: o.number })} · {unitsOf(o)}
                        </RowMeta>
                        <span>
                          <LeaseStatusBadge
                            status={o.status}
                            label={ownershipStatusLabels[o.status]}
                          />
                        </span>
                      </span>
                    </MobileListLink>
                  </li>
                ))}
              </MobileList>
            </>
          )}
        </>
      )}
    </div>
  )
}
