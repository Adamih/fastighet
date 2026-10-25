import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { MoreHorizontal, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { FilterChips, filterChipClass, filterTabClass, StatCard } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useCan } from '#/features/auth/use-can'
import { LeaseStatusBadge } from '#/features/leases/components'
import { leasesQuery } from '#/features/leases/functions'
import { useAddLeaseDrawer, useEditLeaseDrawer } from '#/features/leases/lease-form'
import { tenantKindLabels } from '#/features/leases/options'
import {
  formatShortDate,
  inDays,
  leaseOverview,
  leaseTimeline,
  rentUnit,
  type Timeline,
  type TimelineTone,
  unitSummary,
} from '#/features/leases/overview'
import type { LeaseView } from '#/features/leases/program'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

const statusFilters = ['all', 'active', 'upcoming', 'terminated', 'ended'] as const
type StatusFilter = (typeof statusFilters)[number]
const filterLabels: Record<StatusFilter, string> = {
  get all() {
    return m.filter_all()
  },
  get active() {
    return m.lease_filter_active()
  },
  get upcoming() {
    return m.lease_filter_upcoming()
  },
  get terminated() {
    return m.lease_filter_terminated()
  },
  get ended() {
    return m.lease_filter_ended()
  },
}

export const Route = createFileRoute('/_app/leases/')({
  // Optional so plain /leases stays a clean URL; missing or unknown means "all".
  validateSearch: (search): { status?: StatusFilter } => ({
    status: statusFilters.includes(search.status as StatusFilter)
      ? (search.status as StatusFilter)
      : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(leasesQuery()),
  component: LeasesPage,
})

const toneText: Record<TimelineTone, string> = {
  upcoming: 'text-sky-700 dark:text-sky-300',
  ending: 'text-amber-700 dark:text-amber-300',
  renewing: 'text-muted-foreground',
  neutral: 'text-muted-foreground',
}
const toneBar: Record<TimelineTone, string> = {
  upcoming: 'bg-sky-600',
  ending: 'bg-amber-600',
  renewing: 'bg-emerald-600',
  neutral: 'bg-muted-foreground',
}

function LeasesPage() {
  const can = useCan()
  const canCreate = can({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const canEdit = can({ lease: ['manage'], property: ['read'] })
  const filter = Route.useSearch().status ?? 'all'
  const { data: leases } = useSuspenseQuery(leasesQuery())
  const [query, setQuery] = useState('')
  const addLease = useAddLeaseDrawer()
  const today = stockholmDate(Date.now())
  const overview = leaseOverview(leases, today)

  const needle = query.trim().toLowerCase()
  const visible = leases.filter(
    (l) =>
      (filter === 'all' || l.status === filter) &&
      (!needle ||
        [...l.parties.map((p) => p.name), ...l.units.flatMap((u) => [u.designation, u.label])]
          .join(' ')
          .toLowerCase()
          .includes(needle)),
  )
  const tabs = statusFilters.filter((f) => f !== 'ended' || overview.counts.ended > 0)
  const countLine = [
    m.lease_count({ count: overview.counts.all }),
    overview.counts.active && m.lease_count_active({ count: overview.counts.active }),
    overview.counts.upcoming && m.lease_count_upcoming({ count: overview.counts.upcoming }),
    overview.counts.terminated && m.lease_count_terminated({ count: overview.counts.terminated }),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="grid gap-6 md:gap-7">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 md:flex-nowrap md:items-end">
        <div className="grid min-w-0 flex-1 gap-1 md:flex-none">
          <h1 className="font-bold text-2xl tracking-tight md:text-3xl">{m.nav_leases()}</h1>
          <p className="text-muted-foreground text-sm md:whitespace-nowrap">{countLine}</p>
        </div>
        {/* Phones: the button sits beside the title and the search gets its own row. */}
        <div className="contents md:ml-auto md:flex md:items-center md:gap-2.5">
          {canCreate && (
            <Button className="h-11 md:h-10" onClick={addLease.open} aria-label={m.lease_new()}>
              <Plus aria-hidden="true" />
              <span className="sm:hidden">{m.common_new()}</span>
              <span className="hidden sm:inline">{m.lease_new()}</span>
            </Button>
          )}
          <label className="flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border bg-background px-3 md:order-first md:h-10 md:w-60 lg:w-64">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="sr-only">{m.lease_search_label()}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.lease_search_placeholder()}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
      </header>

      <Summary overview={overview} />

      {leases.length === 0 ? (
        <p className="text-muted-foreground">{m.lease_list_empty()}</p>
      ) : (
        <>
          {/* Phone: chips and cards. */}
          <div className="grid gap-3 md:hidden">
            <FilterChips label={m.lease_filter_label()}>
              {tabs.map((f) => (
                <Link
                  key={f}
                  to="/leases"
                  search={f === 'all' ? {} : { status: f }}
                  aria-current={f === filter ? 'page' : undefined}
                  className={filterChipClass(f === filter)}
                >
                  {filterLabels[f]} <span className="tabular-nums">{overview.counts[f]}</span>
                </Link>
              ))}
            </FilterChips>
            {visible.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground text-sm">
                {m.lease_list_no_match()}
              </p>
            ) : (
              <ul className="grid gap-3">
                {visible.map((lease) => (
                  <LeaseCard key={lease.id} lease={lease} timeline={leaseTimeline(lease, today)} />
                ))}
              </ul>
            )}
          </div>

          {/* Desktop: one card with tabs and the table. */}
          <section className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <nav
              aria-label={m.lease_filter_label()}
              className="flex flex-wrap gap-1 border-b px-3 py-2.5"
            >
              {tabs.map((f) => (
                <Link
                  key={f}
                  to="/leases"
                  search={f === 'all' ? {} : { status: f }}
                  aria-current={f === filter ? 'page' : undefined}
                  className={filterTabClass(f === filter)}
                >
                  {filterLabels[f]} <span className="tabular-nums">{overview.counts[f]}</span>
                </Link>
              ))}
            </nav>
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-muted-foreground text-sm">
                {m.lease_list_no_match()}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px] lg:text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="whitespace-nowrap px-2.5 py-2.5 lg:px-4 lg:py-3 font-semibold">
                        {m.lease_form_tenant()}
                      </th>
                      <th className="whitespace-nowrap px-2.5 py-2.5 lg:px-4 lg:py-3 font-semibold">
                        {m.lease_form_units()}
                      </th>
                      <th className="whitespace-nowrap px-2.5 py-2.5 lg:px-4 lg:py-3 font-semibold">
                        {m.common_period()}
                      </th>
                      <th className="whitespace-nowrap px-2.5 py-2.5 lg:px-4 lg:py-3 text-right font-semibold">
                        {m.common_rent()}
                      </th>
                      <th className="hidden whitespace-nowrap px-2.5 py-2.5 font-semibold lg:table-cell lg:px-4 lg:py-3">
                        {m.common_status()}
                      </th>
                      <th className="whitespace-nowrap px-2.5 py-2.5 lg:px-4 lg:py-3">
                        <span className="sr-only">{m.common_actions()}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((lease) => (
                      <LeaseRow
                        key={lease.id}
                        lease={lease}
                        timeline={leaseTimeline(lease, today)}
                        canEdit={canEdit}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Summary({ overview }: { overview: ReturnType<typeof leaseOverview> }) {
  const rent = (
    <span className="tabular-nums">{formatSekShort(overview.currentMonthlyRentOre)}</span>
  )
  const upcomingHint =
    overview.nextStart &&
    m.lease_summary_next_start({
      date: formatShortDate(overview.nextStart.date),
      when: inDays(overview.nextStart.days),
    })
  const endingHint =
    overview.nextEnd &&
    m.lease_summary_next_end({
      date: formatShortDate(overview.nextEnd.date),
      when: inDays(overview.nextEnd.days),
    })

  return (
    <>
      {/* Phone: one dark card. */}
      <section
        aria-label={m.common_summary()}
        className="grid gap-3.5 rounded-2xl bg-primary p-4 text-primary-foreground md:hidden"
      >
        <div className="grid gap-1">
          <span className="text-primary-foreground/70 text-sm">{m.lease_summary_rent()}</span>
          <span className="font-bold text-2xl tracking-tight">
            {rent}{' '}
            <span className="font-medium text-primary-foreground/70 text-sm">
              {m.lease_summary_rent_unit()}
            </span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              [m.lease_status_active(), overview.counts.active],
              [m.lease_status_upcoming(), overview.counts.upcoming],
              [m.lease_status_terminated(), overview.counts.terminated],
            ] as const
          ).map(([label, count]) => (
            <div key={label} className="grid gap-0.5 rounded-lg bg-primary-foreground/10 p-2.5">
              <span className="font-bold text-lg tabular-nums">{count}</span>
              <span className="text-primary-foreground/70 text-xs">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Desktop: four cards. */}
      <section
        aria-label={m.common_summary()}
        className="hidden gap-3 md:grid md:grid-cols-4 lg:gap-4"
      >
        <StatCard label={m.lease_summary_rent()} hint={m.common_excl_vat()}>
          {rent}
          <span className="font-medium text-muted-foreground text-sm"> {m.common_per_month()}</span>
        </StatCard>
        <StatCard
          label={m.lease_status_active()}
          hint={
            overview.openEndedActive > 0
              ? m.lease_summary_open_ended({ count: overview.openEndedActive })
              : undefined
          }
        >
          {overview.counts.active}
        </StatCard>
        <StatCard
          label={m.lease_status_upcoming()}
          hint={upcomingHint}
          hintClass={toneText.upcoming}
        >
          {overview.counts.upcoming}
        </StatCard>
        <StatCard label={m.lease_filter_terminated()} hint={endingHint} hintClass={toneText.ending}>
          {overview.counts.terminated}
        </StatCard>
      </section>
    </>
  )
}

function ProgressBar({ timeline, className }: { timeline: Timeline; className?: string }) {
  if (timeline.progress === null) return null
  return (
    <span
      role="img"
      aria-label={m.lease_progress_aria({ percent: Math.round(timeline.progress * 100) })}
      className={cn('block h-1 overflow-hidden rounded-full bg-muted', className)}
    >
      <span
        className={cn('block h-1 rounded-full', toneBar[timeline.tone])}
        style={{ width: `${Math.round(timeline.progress * 100)}%` }}
      />
    </span>
  )
}

function UnitChips({ labels }: { labels: string[] }) {
  if (labels.length === 1)
    return <span className="whitespace-nowrap text-muted-foreground text-xs">{labels[0]}</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label}
          className="whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-muted-foreground text-xs"
        >
          {label}
        </span>
      ))}
    </span>
  )
}

function LeaseRow({
  lease,
  timeline,
  canEdit,
}: {
  lease: LeaseView
  timeline: Timeline
  canEdit: boolean
}) {
  const units = unitSummary(lease.units)
  return (
    <tr className="border-b align-top last:border-b-0">
      <td className="px-2.5 py-3 lg:px-4 lg:py-4">
        <div className="grid gap-0.5">
          <Link
            to="/leases/$leaseId"
            params={{ leaseId: lease.id }}
            className="font-semibold underline-offset-4 hover:underline"
          >
            {lease.partyNames}
          </Link>
          <span className="whitespace-nowrap text-muted-foreground text-xs">
            Avtal #{lease.number} · {tenantKindLabels[lease.tenant.kind]}
          </span>
          {/* Below lg the status sits here so every column fits beside the sidebar. */}
          <span className="mt-1 lg:hidden">
            <LeaseStatusBadge status={lease.status} />
          </span>
        </div>
      </td>
      <td className="px-2.5 py-3 lg:px-4 lg:py-4">
        <div className="grid gap-1">
          <span className="whitespace-nowrap">{units.designations}</span>
          <UnitChips labels={units.labels} />
        </div>
      </td>
      <td className="px-2.5 py-3 tabular-nums lg:px-4 lg:py-4">
        <div className="grid gap-1.5">
          <span className="whitespace-nowrap">{timeline.period}</span>
          <ProgressBar timeline={timeline} className="w-32 lg:w-40" />
          <span className={cn('text-xs', toneText[timeline.tone])}>{timeline.note}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-2.5 py-3 text-right tabular-nums lg:px-4 lg:py-4">
        <span className="font-semibold">{formatSekShort(lease.rentOre)}</span>
        <div className="text-muted-foreground text-xs">{rentUnit(lease)}</div>
      </td>
      <td className="hidden px-2.5 py-3 lg:table-cell lg:px-4 lg:py-4">
        <LeaseStatusBadge status={lease.status} />
      </td>
      <td className="px-1 py-2 text-right lg:px-2 lg:py-3">
        <LeaseActions lease={lease} canEdit={canEdit} />
      </td>
    </tr>
  )
}

function LeaseActions({ lease, canEdit }: { lease: LeaseView; canEdit: boolean }) {
  const edit = useEditLeaseDrawer(lease)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label={m.lease_more_actions({ number: lease.number })}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/leases/$leaseId" params={{ leaseId: lease.id }}>
            {m.lease_view()}
          </Link>
        </DropdownMenuItem>
        {canEdit && <DropdownMenuItem onSelect={edit.open}>{m.lease_edit()}</DropdownMenuItem>}
        <DropdownMenuItem asChild>
          <Link to="/tenants/$tenantId" params={{ tenantId: lease.tenant.id }}>
            {m.lease_view_tenant()}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LeaseCard({ lease, timeline }: { lease: LeaseView; timeline: Timeline }) {
  const units = unitSummary(lease.units)
  return (
    <li>
      <Link
        to="/leases/$leaseId"
        params={{ leaseId: lease.id }}
        className="grid gap-2.5 rounded-xl border bg-card p-4 text-foreground hover:bg-muted/40 hover:text-foreground"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="grid min-w-0 gap-1">
            <span className="truncate font-semibold text-base">{lease.partyNames}</span>
            <span className="truncate text-muted-foreground text-sm">
              {units.designations}
              {units.labels.length === 1 && ` · ${units.labels[0]}`}
            </span>
            {units.labels.length > 1 && <UnitChips labels={units.labels} />}
          </span>
          <LeaseStatusBadge status={lease.status} />
        </span>
        <ProgressBar timeline={timeline} />
        <span className="flex items-end justify-between gap-3 border-t pt-2.5 text-[13px] tabular-nums">
          <span className="grid min-w-0 gap-0.5">
            <span>{timeline.cardPeriod}</span>
            <span className={cn('font-medium', toneText[timeline.tone])}>{timeline.note}</span>
          </span>
          <span className="grid shrink-0 justify-items-end">
            <span className="whitespace-nowrap font-bold text-base">
              {formatSekShort(lease.rentOre)}
              <span className="font-medium text-muted-foreground text-xs">
                {lease.rentInterval === 'monthly' ? m.common_per_month() : m.common_per_year()}
              </span>
            </span>
            {lease.vat && (
              <span className="text-muted-foreground text-xs">{m.lease_plus_vat()}</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  )
}
