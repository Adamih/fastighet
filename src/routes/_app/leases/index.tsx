import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { MoreHorizontal, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { FilterChips } from '#/components/responsive'
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

const statusFilters = ['all', 'active', 'upcoming', 'terminated', 'ended'] as const
type StatusFilter = (typeof statusFilters)[number]
const filterLabels: Record<StatusFilter, string> = {
  all: 'Alla',
  active: 'Gällande',
  upcoming: 'Kommande',
  terminated: 'Uppsagda',
  ended: 'Avslutade',
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
  const today = stockholmDate(Date.now())
  const overview = leaseOverview(leases, today)

  const needle = query.trim().toLowerCase()
  const visible = leases.filter(
    (l) =>
      (filter === 'all' || l.status === filter) &&
      (!needle ||
        [l.tenant.name, ...l.units.flatMap((u) => [u.designation, u.label])]
          .join(' ')
          .toLowerCase()
          .includes(needle)),
  )
  const tabs = statusFilters.filter((f) => f !== 'ended' || overview.counts.ended > 0)
  const countLine = [
    `${overview.counts.all} avtal`,
    overview.counts.active && `${overview.counts.active} gällande`,
    overview.counts.upcoming && `${overview.counts.upcoming} kommande`,
    overview.counts.terminated && `${overview.counts.terminated} uppsagt`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="grid gap-6 md:gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="font-bold text-2xl tracking-tight md:text-3xl">Avtal</h1>
          <p className="text-muted-foreground text-sm">{countLine}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background px-3 md:h-10 md:w-64 md:flex-none">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="sr-only">Sök avtal</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sök hyresgäst eller objekt"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          {canCreate && (
            <Button asChild className="h-11 md:h-10">
              <Link to="/leases/new">
                <Plus aria-hidden="true" />
                Nytt avtal
              </Link>
            </Button>
          )}
        </div>
      </header>

      <Summary overview={overview} />

      {leases.length === 0 ? (
        <p className="text-muted-foreground">Inga avtal ännu.</p>
      ) : (
        <>
          {/* Phone: chips and cards. */}
          <div className="grid gap-3 md:hidden">
            <FilterChips label="Filtrera avtal">
              {tabs.map((f) => (
                <Link
                  key={f}
                  to="/leases"
                  search={f === 'all' ? {} : { status: f }}
                  aria-current={f === filter ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-sm',
                    f === filter
                      ? 'border-foreground bg-foreground font-semibold text-background'
                      : 'bg-background text-muted-foreground',
                  )}
                >
                  {filterLabels[f]} <span className="tabular-nums">{overview.counts[f]}</span>
                </Link>
              ))}
            </FilterChips>
            {visible.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground text-sm">Inga avtal matchar.</p>
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
            <nav aria-label="Filtrera avtal" className="flex flex-wrap gap-1 border-b px-3 py-2.5">
              {tabs.map((f) => (
                <Link
                  key={f}
                  to="/leases"
                  search={f === 'all' ? {} : { status: f }}
                  aria-current={f === filter ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm',
                    f === filter
                      ? 'bg-accent font-semibold text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {filterLabels[f]} <span className="tabular-nums">{overview.counts[f]}</span>
                </Link>
              ))}
            </nav>
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-muted-foreground text-sm">
                Inga avtal matchar.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="px-4 py-3 font-semibold">Hyresgäst</th>
                      <th className="px-4 py-3 font-semibold">Objekt</th>
                      <th className="px-4 py-3 font-semibold">Period</th>
                      <th className="px-4 py-3 text-right font-semibold">Hyra</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3">
                        <span className="sr-only">Åtgärder</span>
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
    `Startar ${formatShortDate(overview.nextStart.date)} – ${inDays(overview.nextStart.days)}`
  const endingHint =
    overview.nextEnd &&
    `Upphör ${formatShortDate(overview.nextEnd.date)} – ${inDays(overview.nextEnd.days)}`

  return (
    <>
      {/* Phone: one dark card. */}
      <section
        aria-label="Sammanfattning"
        className="grid gap-3.5 rounded-2xl bg-primary p-4 text-primary-foreground md:hidden"
      >
        <div className="grid gap-1">
          <span className="text-primary-foreground/70 text-sm">Hyra, gällande avtal</span>
          <span className="font-bold text-2xl tracking-tight">
            {rent}{' '}
            <span className="font-medium text-primary-foreground/70 text-sm">/mån exkl. moms</span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['Gällande', overview.counts.active],
              ['Kommande', overview.counts.upcoming],
              ['Uppsagt', overview.counts.terminated],
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
        aria-label="Sammanfattning"
        className="hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-4"
      >
        <SummaryCard label="Hyra, gällande avtal" hint="exkl. moms">
          {rent}
          <span className="font-medium text-muted-foreground text-sm"> /mån</span>
        </SummaryCard>
        <SummaryCard
          label="Gällande"
          hint={
            overview.openEndedActive > 0
              ? `varav ${overview.openEndedActive} tillsvidare`
              : undefined
          }
        >
          {overview.counts.active}
        </SummaryCard>
        <SummaryCard label="Kommande" hint={upcomingHint} hintClass={toneText.upcoming}>
          {overview.counts.upcoming}
        </SummaryCard>
        <SummaryCard label="Uppsagda" hint={endingHint} hintClass={toneText.ending}>
          {overview.counts.terminated}
        </SummaryCard>
      </section>
    </>
  )
}

function SummaryCard({
  label,
  hint,
  hintClass,
  children,
}: {
  label: string
  hint?: string | null
  hintClass?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid content-start gap-1.5 rounded-xl border bg-card px-5 py-4">
      <span className="font-medium text-muted-foreground text-sm">{label}</span>
      <span className="font-bold text-2xl tabular-nums tracking-tight">{children}</span>
      {hint && <span className={cn('text-muted-foreground text-xs', hintClass)}>{hint}</span>}
    </div>
  )
}

function ProgressBar({ timeline, className }: { timeline: Timeline; className?: string }) {
  if (timeline.progress === null) return null
  return (
    <span
      role="img"
      aria-label={`${Math.round(timeline.progress * 100)} % av avtalstiden har gått`}
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
  if (labels.length === 1) return <span className="text-muted-foreground text-xs">{labels[0]}</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span key={label} className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground text-xs">
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
      <td className="px-4 py-4">
        <div className="grid gap-0.5">
          <Link
            to="/leases/$leaseId"
            params={{ leaseId: lease.id }}
            className="font-semibold underline-offset-4 hover:underline"
          >
            {lease.tenant.name}
          </Link>
          <span className="text-muted-foreground text-xs">
            Avtal #{lease.number} · {tenantKindLabels[lease.tenant.kind]}
          </span>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="grid gap-1">
          <span>{units.designations}</span>
          <UnitChips labels={units.labels} />
        </div>
      </td>
      <td className="px-4 py-4 tabular-nums">
        <div className="grid gap-1.5">
          <span>{timeline.period}</span>
          <ProgressBar timeline={timeline} className="w-40" />
          <span className={cn('text-xs', toneText[timeline.tone])}>{timeline.note}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
        <span className="font-semibold">{formatSekShort(lease.rentOre)}</span>
        <div className="text-muted-foreground text-xs">{rentUnit(lease)}</div>
      </td>
      <td className="px-4 py-4">
        <LeaseStatusBadge status={lease.status} />
      </td>
      <td className="px-2 py-3 text-right">
        <LeaseActions lease={lease} canEdit={canEdit} />
      </td>
    </tr>
  )
}

function LeaseActions({ lease, canEdit }: { lease: LeaseView; canEdit: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label={`Fler åtgärder för avtal ${lease.number}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/leases/$leaseId" params={{ leaseId: lease.id }}>
            Visa avtal
          </Link>
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem asChild>
            <Link to="/leases/$leaseId/edit" params={{ leaseId: lease.id }}>
              Ändra avtal
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/tenants/$tenantId" params={{ tenantId: lease.tenant.id }}>
            Visa hyresgäst
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
        className="grid gap-2.5 rounded-xl border bg-card p-4 hover:bg-muted/40"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="grid min-w-0 gap-1">
            <span className="truncate font-semibold">{lease.tenant.name}</span>
            <span className="truncate text-muted-foreground text-sm">
              {units.designations}
              {units.labels.length === 1 && ` · ${units.labels[0]}`}
            </span>
            {units.labels.length > 1 && <UnitChips labels={units.labels} />}
          </span>
          <LeaseStatusBadge status={lease.status} />
        </span>
        <ProgressBar timeline={timeline} />
        <span className="flex items-end justify-between gap-3 border-t pt-2.5 text-sm tabular-nums">
          <span className="grid min-w-0 gap-0.5">
            <span>{timeline.period}</span>
            <span className={cn('font-medium', toneText[timeline.tone])}>{timeline.note}</span>
          </span>
          <span className="grid shrink-0 justify-items-end">
            <span className="font-bold">
              {formatSekShort(lease.rentOre)}
              <span className="font-medium text-muted-foreground text-xs">
                {lease.rentInterval === 'monthly' ? '/mån' : '/år'}
              </span>
            </span>
            {lease.vat && <span className="text-muted-foreground text-xs">+ moms</span>}
          </span>
        </span>
      </Link>
    </li>
  )
}
