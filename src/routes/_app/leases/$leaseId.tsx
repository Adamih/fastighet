import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  CircleCheck,
  DoorOpen,
  FilePlus,
  FileX,
  KeyRound,
  type LucideIcon,
  Mail,
  Pencil,
  Phone,
  Send,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import {
  DetailColumns,
  type DetailEvent,
  DetailHeader,
  EventList,
  type EventTone,
  FactList,
  Panel,
  PanelRow,
  StatRow,
} from '#/components/detail'
import { InitialsAvatar } from '#/components/initials-avatar'
import { StatCard } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { invoicesQuery, type listInvoicesFn } from '#/features/invoicing/functions'
import { invoiceCount, invoiceOverview } from '#/features/invoicing/overview'
import { periodLabel } from '#/features/invoicing/rules'
import { LeaseStatusBadge } from '#/features/leases/components'
import {
  type LeaseEvent,
  type LeaseEventKind,
  leaseEvents,
  nextInvoicePeriod,
  shortPeriodLabel,
} from '#/features/leases/detail'
import { leaseQuery, leasesQuery, withdrawTerminationFn } from '#/features/leases/functions'
import { invoiceIntervalLabels, tenantKindLabels } from '#/features/leases/options'
import {
  daysUntil,
  formatShortDate,
  inDays,
  leaseTimeline,
  type Timeline,
  type TimelineTone,
  unitLabel,
  unitSummary,
} from '#/features/leases/overview'
import type { LeaseView } from '#/features/leases/program'
import { useTerminateLeaseDrawer } from '#/features/leases/terminate-form'
import { effectiveEndDate } from '#/features/leases/terms'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_app/leases/$leaseId')({
  loader: ({ context, params }) => {
    // Invoices are optional data: prefetch (which never throws) so the page renders with them.
    void context.queryClient.prefetchQuery(
      invoicesQuery({ filter: 'all', leaseId: params.leaseId }),
    )
    return context.queryClient.ensureQueryData(leaseQuery(params.leaseId))
  },
  component: LeasePage,
})

function LeasePage() {
  const can = useCan()
  const canManage = can({ lease: ['manage'] })
  const canReadInvoices = can({ invoice: ['read'] })
  const { leaseId } = Route.useParams()
  const { data: lease } = useSuspenseQuery(leaseQuery(leaseId))
  const { data: invoices = [] } = useQuery({
    ...invoicesQuery({ filter: 'all', leaseId }),
    enabled: canReadInvoices,
  })
  const terminate = useTerminateLeaseDrawer(lease)
  const today = stockholmDate(Date.now())

  const queryClient = useQueryClient()
  const withdraw = useMutation({
    mutationFn: withdrawTerminationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: leasesQuery().queryKey })
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })

  const units = unitSummary(lease.units)
  const timeline = leaseTimeline(lease, today)
  const leaseInvoices = invoices.map((i) => ({
    ...i,
    sentOn: i.sentAt ? stockholmDate(i.sentAt.getTime()) : null,
  }))
  const open = lease.status !== 'ended'

  return (
    <div className="grid gap-6 md:gap-7">
      <DetailHeader
        back={{ label: 'Avtal', to: '/leases' }}
        crumb={`Avtal #${lease.number}`}
        title={lease.tenant.name}
        badge={<LeaseStatusBadge status={lease.status} />}
        meta={[`Avtal #${lease.number}`, units.designations, units.labels.join(', ')]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canManage && (
            <>
              {can({ property: ['read'] }) && (
                <Button variant="outline" className="flex-1 sm:flex-none" asChild>
                  <Link to="/leases/$leaseId/edit" params={{ leaseId }}>
                    <Pencil aria-hidden="true" />
                    Ändra
                  </Link>
                </Button>
              )}
              {open && !lease.moveOutDate && (
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={terminate.open}>
                  <FileX aria-hidden="true" />
                  Säg upp
                </Button>
              )}
              {open && lease.moveOutDate && (
                <Button
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate({ data: { leaseId } })}
                >
                  <Undo2 aria-hidden="true" />
                  Ångra uppsägning
                </Button>
              )}
            </>
          )
        }
      />
      {withdraw.error && <p className="text-destructive text-sm">{withdraw.error.message}</p>}

      <LeaseStats lease={lease} invoices={leaseInvoices} today={today} />

      <DetailColumns
        main={
          <>
            <Panel title="Avtalets gång">
              <LeaseProgress lease={lease} timeline={timeline} />
            </Panel>
            {canReadInvoices && <LeaseInvoices invoices={invoices} />}
            <Panel title="Händelser">
              <EventList
                events={leaseEvents(
                  { ...lease, createdOn: stockholmDate(lease.createdAt.getTime()) },
                  leaseInvoices,
                  today,
                ).map((e) => eventView(e))}
              />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Hyresgäst">
              <div className="flex items-center gap-3">
                <InitialsAvatar name={lease.tenant.name} square={lease.tenant.kind === 'company'} />
                <div className="grid min-w-0 gap-0.5 text-[13px]">
                  <Link
                    to="/tenants/$tenantId"
                    params={{ tenantId: lease.tenant.id }}
                    className="truncate font-semibold underline-offset-4 hover:underline"
                  >
                    {lease.tenant.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {tenantKindLabels[lease.tenant.kind]}
                  </span>
                </div>
              </div>
              {lease.contact && (lease.contact.email || lease.contact.phone) && (
                <div className="grid gap-1.5 text-[13px]">
                  {lease.contact.email && (
                    <a
                      href={`mailto:${lease.contact.email}`}
                      className="flex min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground"
                    >
                      <Mail aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="truncate">{lease.contact.email}</span>
                    </a>
                  )}
                  {lease.contact.phone && (
                    <a
                      href={`tel:${lease.contact.phone.replace(/[^\d+]/g, '')}`}
                      className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                    >
                      <Phone aria-hidden="true" className="size-3.5 shrink-0" />
                      {lease.contact.phone}
                    </a>
                  )}
                </div>
              )}
            </Panel>
            <Panel title={lease.units.length === 1 ? 'Objekt' : `Objekt (${lease.units.length})`}>
              <div>
                {lease.units.map((u) => (
                  <PanelRow key={u.id}>
                    <span className="grid min-w-0 gap-0.5">
                      <Link
                        to="/units/$unitId"
                        params={{ unitId: u.id }}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {unitLabel(u)}
                      </Link>
                      <Link
                        to="/properties/$propertyId"
                        params={{ propertyId: u.propertyId }}
                        className="truncate text-muted-foreground underline-offset-4 hover:underline"
                      >
                        {u.designation}
                      </Link>
                    </span>
                    {u.areaSqm != null && (
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {areaFormat.format(u.areaSqm)} m²
                      </span>
                    )}
                  </PanelRow>
                ))}
              </div>
            </Panel>
            <Panel title="Villkor">
              <FactList
                facts={[
                  ['Start', lease.startDate],
                  ['Slut', effectiveEndDate(lease) ?? lease.endDate ?? 'Tillsvidare'],
                  [
                    'Hyra',
                    `${formatSekShort(lease.rentOre)} ${lease.rentInterval === 'monthly' ? '/mån' : '/år'}${lease.vat ? ' + moms' : ''}`,
                  ],
                  ['Avisering', invoiceIntervalLabels[lease.invoiceInterval]],
                  ['Uppsägningstid', `${lease.noticePeriodMonths} mån`],
                  [
                    'Förlängning',
                    lease.endDate && lease.extensionMonths ? `${lease.extensionMonths} mån` : '–',
                  ],
                  ['Moms', lease.vat ? 'Ja, 25 %' : 'Nej'],
                  ...(lease.noticeDate ? ([['Uppsagt', lease.noticeDate]] as const) : []),
                ]}
              />
            </Panel>
          </>
        }
      />

      {canManage && terminate.drawer}
    </div>
  )
}

const areaFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 })

type LeaseInvoice = LeaseInvoiceRow & { sentOn: string | null }
type LeaseInvoiceRow = Awaited<ReturnType<typeof listInvoicesFn>>[number]

function LeaseStats({
  lease,
  invoices,
  today,
}: {
  lease: LeaseView
  invoices: LeaseInvoice[]
  today: string
}) {
  const can = useCan()
  const end = effectiveEndDate(lease)
  const [dateLabel, dateValue, dateHint, dateTone] =
    lease.status === 'upcoming'
      ? [
          'Tillträde',
          formatShortDate(lease.startDate),
          inDays(daysUntil(today, lease.startDate)),
          toneText.upcoming,
        ]
      : lease.status === 'ended'
        ? ['Avslutat', end ? formatShortDate(end) : '–', end ?? '', undefined]
        : end
          ? [
              lease.moveOutDate ? 'Avflyttning' : 'Slutdatum',
              formatShortDate(end),
              inDays(daysUntil(today, end)),
              toneText.ending,
            ]
          : lease.endDate
            ? [
                'Förlängs',
                formatShortDate(lease.endDate),
                `med ${lease.extensionMonths} mån om ej uppsagt`,
                undefined,
              ]
            : ['Löptid', 'Tillsvidare', `sedan ${lease.startDate}`, undefined]

  const overview = invoiceOverview(invoices, today)
  const next = lease.status !== 'ended' ? nextInvoicePeriod(lease, invoices, today) : null
  return (
    <StatRow>
      <StatCard label="Hyra" hint={lease.vat ? 'exkl. moms' : undefined}>
        {formatSekShort(lease.rentOre)}
        <span className="font-medium text-muted-foreground text-sm">
          {lease.rentInterval === 'monthly' ? ' /mån' : ' /år'}
        </span>
      </StatCard>
      <StatCard label={dateLabel} hint={dateHint} hintClass={dateTone}>
        {dateValue}
      </StatCard>
      {can({ invoice: ['read'] }) ? (
        <>
          <StatCard
            label="Utestående"
            tone={overview.overdue.count > 0 ? 'danger' : 'default'}
            hint={
              overview.overdue.count > 0
                ? `${invoiceCount(overview.overdue.count)} förfallen`
                : overview.outstanding.count > 0
                  ? `${invoiceCount(overview.outstanding.count)} obetald`
                  : 'Inga obetalda avier'
            }
          >
            {formatSekShort(overview.outstanding.totalOre)}
          </StatCard>
          <StatCard
            label="Nästa avi"
            hint={next ? invoiceIntervalLabels[lease.invoiceInterval] : undefined}
          >
            {next ? shortPeriodLabel(next) : '–'}
          </StatCard>
        </>
      ) : (
        <>
          <StatCard label="Uppsägningstid">{lease.noticePeriodMonths} mån</StatCard>
          <StatCard label="Avisering">{invoiceIntervalLabels[lease.invoiceInterval]}</StatCard>
        </>
      )}
    </StatRow>
  )
}

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

/** The lease's period as a bar with its milestones underneath. */
function LeaseProgress({ lease, timeline }: { lease: LeaseView; timeline: Timeline }) {
  const end = effectiveEndDate(lease)
  const milestones: [string, string][] = [
    [lease.startDate, 'Tillträde'],
    ...(lease.noticeDate ? ([[lease.noticeDate, 'Uppsagt']] as [string, string][]) : []),
    end
      ? [end, lease.moveOutDate ? 'Avflyttning' : 'Slutdatum']
      : lease.endDate
        ? [lease.endDate, 'Slutdatum, förlängs']
        : ['Tillsvidare', 'Ingen slutdag'],
  ]
  return (
    <div className="grid gap-3">
      {timeline.progress === null ? (
        <span className="block h-1.5 rounded-full bg-muted" />
      ) : (
        <span
          role="img"
          aria-label={`${Math.round(timeline.progress * 100)} % av avtalstiden har gått`}
          className="block h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <span
            className={cn('block h-1.5 rounded-full', toneBar[timeline.tone])}
            style={{ width: `${Math.round(timeline.progress * 100)}%` }}
          />
        </span>
      )}
      <ol className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        {milestones.map(([date, label]) => (
          <li key={label} className="grid gap-0.5">
            <span className="font-medium tabular-nums">{date}</span>
            <span className="text-muted-foreground">{label}</span>
          </li>
        ))}
        <li className="grid gap-0.5 sm:text-right">
          <span className={cn('font-medium', toneText[timeline.tone])}>{timeline.note}</span>
          <span className="text-muted-foreground">
            {timeline.progress === null
              ? 'Status'
              : `${Math.round(timeline.progress * 100)} % av tiden`}
          </span>
        </li>
      </ol>
    </div>
  )
}

const eventIcons: Record<LeaseEventKind, [LucideIcon, EventTone]> = {
  created: [FilePlus, 'neutral'],
  started: [KeyRound, 'good'],
  noticeGiven: [FileX, 'warn'],
  movedOut: [DoorOpen, 'neutral'],
  invoiceSent: [Send, 'neutral'],
  invoicePaid: [CircleCheck, 'good'],
}

function eventView(e: LeaseEvent): DetailEvent {
  const [icon, tone] = eventIcons[e.kind]
  const text = {
    created: 'Avtalet registrerades',
    started: 'Tillträde',
    noticeGiven: 'Avtalet sades upp',
    movedOut: 'Avflyttning',
    invoiceSent: `Avi #${e.invoiceNumber} skickades`,
    invoicePaid: `Avi #${e.invoiceNumber} betalades`,
  }[e.kind]
  return { key: `${e.kind}-${e.date}-${e.invoiceNumber ?? ''}`, icon, tone, text, date: e.date }
}

function LeaseInvoices({ invoices }: { invoices: LeaseInvoiceRow[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? invoices : invoices.slice(0, 5)
  return (
    <Panel
      title="Avier"
      action={
        invoices.length > 5 && (
          <button
            type="button"
            onClick={() => setAll((a) => !a)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {all ? 'Visa färre' : `Visa alla ${invoices.length}`}
          </button>
        )
      }
    >
      {invoices.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Inga avier ännu.</p>
      ) : (
        <div>
          {shown.map((i) => (
            <PanelRow key={i.id}>
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: i.id }}
                className="min-w-0 truncate underline-offset-4 hover:underline"
              >
                <span className="font-semibold">#{i.number}</span>{' '}
                <span className="text-muted-foreground">
                  · {periodLabel({ start: i.periodStart, end: i.periodEnd })}
                </span>
              </Link>
              <span className="flex shrink-0 items-center gap-3">
                <span className="font-semibold tabular-nums">{formatSekShort(i.totalOre)}</span>
                <InvoiceStatusBadge status={i.status} />
              </span>
            </PanelRow>
          ))}
        </div>
      )}
    </Panel>
  )
}
