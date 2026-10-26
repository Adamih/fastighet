import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Banknote,
  CalendarClock,
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
  MoreActions,
  Panel,
  PanelRow,
  StatRow,
} from '#/components/detail'
import { InitialsAvatar } from '#/components/initials-avatar'
import { StatCard } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import { useChangeBaseChargeDrawer } from '#/features/agreements/change-charge-form'
import { ChargesPanel } from '#/features/agreements/charges-panel'
import { useAddOneOffDrawer } from '#/features/agreements/one-off-form'
import { useCan } from '#/features/auth/use-can'
import { IndexClausePanel } from '#/features/indexation/index-clause-form'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { owedOrTotal } from '#/features/invoicing/credit'
import { invoicesQuery, type listInvoicesFn } from '#/features/invoicing/functions'
import { invoiceOverview } from '#/features/invoicing/overview'
import { periodLabel } from '#/features/invoicing/rules'
import { useChangeLeaseFromDrawer } from '#/features/leases/change-from-form'
import { LeaseStatusBadge } from '#/features/leases/components'
import {
  type LeaseEvent,
  type LeaseEventKind,
  leaseEvents,
  nextInvoicePeriod,
  shortPeriodLabel,
} from '#/features/leases/detail'
import { leaseQuery, leasesQuery, withdrawTerminationFn } from '#/features/leases/functions'
import { useEditLeaseDrawer } from '#/features/leases/lease-form'
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
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/leases/$leaseId')({
  loader: ({ context, params }) => {
    // Invoices are optional data: prefetch (which never throws) so the page renders with them.
    void context.queryClient.prefetchQuery(
      invoicesQuery({ filter: 'all', agreementId: params.leaseId }),
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
    ...invoicesQuery({ filter: 'all', agreementId: leaseId }),
    enabled: canReadInvoices,
  })
  const terminate = useTerminateLeaseDrawer(lease)
  const edit = useEditLeaseDrawer(lease)
  const changeRent = useChangeBaseChargeDrawer(lease)
  const changeFrom = useChangeLeaseFromDrawer(lease)
  const addOneOff = useAddOneOffDrawer(lease)
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
        back={{ label: m.nav_leases(), to: '/leases' }}
        crumb={m.lease_number({ number: lease.number })}
        title={lease.partyNames}
        badge={<LeaseStatusBadge status={lease.status} />}
        meta={[
          m.lease_number({ number: lease.number }),
          units.designations,
          units.labels.join(', '),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canManage && (
            <>
              {can({ property: ['read'] }) && (
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={edit.open}>
                  <Pencil aria-hidden="true" />
                  {m.common_edit()}
                </Button>
              )}
              {open && !lease.moveOutDate && (
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={terminate.open}>
                  <FileX aria-hidden="true" />
                  {m.lease_terminate()}
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
                  {m.lease_withdraw_termination()}
                </Button>
              )}
              {open && (
                <MoreActions label={m.invoice_more_actions({ number: lease.number })}>
                  <DropdownMenuItem onSelect={changeRent.open}>
                    <Banknote aria-hidden="true" />
                    {changeRent.label}
                  </DropdownMenuItem>
                  {can({ tenant: ['read'], property: ['read'] }) && (
                    <DropdownMenuItem onSelect={changeFrom.open}>
                      <CalendarClock aria-hidden="true" />
                      {m.lease_change_from()}
                    </DropdownMenuItem>
                  )}
                </MoreActions>
              )}
            </>
          )
        }
      />
      {withdraw.error && <p className="text-destructive text-sm">{withdraw.error.message}</p>}
      {changeRent.notice && (
        <p className="text-[13px] text-emerald-700 dark:text-emerald-300">{changeRent.notice}</p>
      )}

      <LeaseStats lease={lease} invoices={leaseInvoices} today={today} />

      <DetailColumns
        main={
          <>
            <Panel title={m.lease_progress_title()}>
              <LeaseProgress lease={lease} timeline={timeline} />
            </Panel>
            {canReadInvoices && <LeaseInvoices invoices={invoices} />}
            <Panel title={m.detail_events()}>
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
            <Panel title={lease.parties.length > 1 ? m.lease_tenants() : m.lease_form_tenant()}>
              <ul className="grid gap-4">
                {lease.parties.map((party) => (
                  <li key={party.id} className="grid gap-2.5">
                    <div className="flex items-center gap-3">
                      <InitialsAvatar name={party.name} square={party.kind === 'company'} />
                      <div className="grid min-w-0 gap-0.5 text-[13px]">
                        <Link
                          to="/tenants/$tenantId"
                          params={{ tenantId: party.id }}
                          className="truncate font-semibold underline-offset-4 hover:underline"
                        >
                          {party.name}
                        </Link>
                        <span className="text-muted-foreground">
                          {[
                            party.role === 'co_tenant'
                              ? m.lease_co_tenant()
                              : tenantKindLabels[party.kind],
                            lease.parties.length > 1 && party.receivesInvoices
                              ? m.lease_receives_invoices()
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                    </div>
                    {party.contact && (party.contact.email || party.contact.phone) && (
                      <div className="grid gap-1.5 text-[13px]">
                        {party.contact.email && (
                          <a
                            href={`mailto:${party.contact.email}`}
                            className="flex min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground"
                          >
                            <Mail aria-hidden="true" className="size-3.5 shrink-0" />
                            <span className="truncate">{party.contact.email}</span>
                          </a>
                        )}
                        {party.contact.phone && (
                          <a
                            href={`tel:${party.contact.phone.replace(/[^\d+]/g, '')}`}
                            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                          >
                            <Phone aria-hidden="true" className="size-3.5 shrink-0" />
                            {party.contact.phone}
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <PartyHistory lease={lease} today={today} />
            </Panel>
            <Panel
              title={
                lease.units.length === 1
                  ? m.lease_form_units()
                  : m.lease_units_count({ count: lease.units.length })
              }
            >
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
            <ChargesPanel
              agreement={lease}
              units={lease.unitRows}
              today={today}
              canManage={canManage}
              onAddOneOff={addOneOff.open}
            />
            <IndexClausePanel lease={lease} canManage={canManage} />
            <Panel title="Villkor">
              <FactList
                facts={[
                  [m.lease_fact_start(), lease.startDate],
                  [
                    m.lease_fact_end(),
                    effectiveEndDate(lease) ?? lease.termEndDate ?? m.lease_open_ended(),
                  ],
                  [
                    m.common_rent(),
                    `${formatSekShort(lease.rentOre)} ${lease.rentInterval === 'monthly' ? m.common_per_month() : m.common_per_year()}${lease.vat ? ` ${m.lease_plus_vat()}` : ''}`,
                  ],
                  [m.lease_form_invoice_interval(), invoiceIntervalLabels[lease.invoiceInterval]],
                  [
                    m.lease_notice_period(),
                    m.common_months_short({ months: lease.noticePeriodMonths }),
                  ],
                  [
                    m.lease_extension(),
                    lease.termEndDate && lease.extensionMonths
                      ? m.common_months_short({ months: lease.extensionMonths })
                      : '–',
                  ],
                  [m.lease_vat(), lease.vat ? m.lease_vat_yes() : m.common_no()],
                  ...(lease.noticeDate
                    ? ([[m.lease_status_terminated(), lease.noticeDate]] as const)
                    : []),
                ]}
              />
            </Panel>
          </>
        }
      />
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
          m.lease_form_start(),
          formatShortDate(lease.startDate),
          inDays(daysUntil(today, lease.startDate)),
          toneText.upcoming,
        ]
      : lease.status === 'ended'
        ? [m.lease_status_ended(), end ? formatShortDate(end) : '–', end ?? '', undefined]
        : end
          ? [
              lease.moveOutDate ? m.lease_move_out() : m.lease_end_date(),
              formatShortDate(end),
              inDays(daysUntil(today, end)),
              toneText.ending,
            ]
          : lease.termEndDate
            ? [
                m.lease_renews(),
                formatShortDate(lease.termEndDate),
                m.lease_renews_hint({ months: lease.extensionMonths ?? 0 }),
                undefined,
              ]
            : [
                m.lease_term_label(),
                m.lease_open_ended(),
                m.lease_since({ date: lease.startDate }),
                undefined,
              ]

  const overview = invoiceOverview(invoices, today)
  const next = lease.status !== 'ended' ? nextInvoicePeriod(lease, invoices, today) : null
  return (
    <StatRow>
      <StatCard label={m.common_rent()} hint={lease.vat ? m.common_excl_vat() : undefined}>
        {formatSekShort(lease.rentOre)}
        <span className="font-medium text-muted-foreground text-sm">
          {' '}
          {lease.rentInterval === 'monthly' ? m.common_per_month() : m.common_per_year()}
        </span>
      </StatCard>
      <StatCard label={dateLabel} hint={dateHint} hintClass={dateTone}>
        {dateValue}
      </StatCard>
      {can({ invoice: ['read'] }) ? (
        <>
          <StatCard
            label={m.common_outstanding()}
            tone={overview.overdue.count > 0 ? 'danger' : 'default'}
            hint={
              overview.overdue.count > 0
                ? m.invoice_count_overdue({ count: overview.overdue.count })
                : overview.outstanding.count > 0
                  ? m.invoice_count_unpaid({ count: overview.outstanding.count })
                  : m.invoice_none_unpaid()
            }
          >
            {formatSekShort(overview.outstanding.totalOre)}
          </StatCard>
          <StatCard
            label={m.lease_next_invoice()}
            hint={next ? invoiceIntervalLabels[lease.invoiceInterval] : undefined}
          >
            {next ? shortPeriodLabel(next) : '–'}
          </StatCard>
        </>
      ) : (
        <>
          <StatCard label={m.lease_notice_period()}>
            {m.common_months_short({ months: lease.noticePeriodMonths })}
          </StatCard>
          <StatCard label={m.lease_form_invoice_interval()}>
            {invoiceIntervalLabels[lease.invoiceInterval]}
          </StatCard>
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
    [lease.startDate, m.lease_form_start()],
    ...(lease.noticeDate
      ? ([[lease.noticeDate, m.lease_status_terminated()]] as [string, string][])
      : []),
    end
      ? [end, lease.moveOutDate ? m.lease_move_out() : m.lease_end_date()]
      : lease.termEndDate
        ? [lease.termEndDate, m.lease_end_date_renews()]
        : [m.lease_open_ended(), m.lease_no_end_date()],
  ]
  return (
    <div className="grid gap-3">
      {timeline.progress === null ? (
        <span className="block h-1.5 rounded-full bg-muted" />
      ) : (
        <span
          role="img"
          aria-label={m.lease_progress_aria({ percent: Math.round(timeline.progress * 100) })}
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
              ? m.lease_progress_status()
              : m.lease_progress_percent({ percent: Math.round(timeline.progress * 100) })}
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
    created: m.lease_event_created(),
    started: m.lease_form_start(),
    noticeGiven: m.lease_event_notice_given(),
    movedOut: m.lease_move_out(),
    invoiceSent: m.lease_event_invoice_sent({ number: e.invoiceNumber ?? 0 }),
    invoicePaid: m.lease_event_invoice_paid({ number: e.invoiceNumber ?? 0 }),
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
            {all ? m.common_show_fewer() : m.common_show_all({ count: invoices.length })}
          </button>
        )
      }
    >
      {invoices.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{m.invoice_list_empty()}</p>
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
                <span className="font-semibold tabular-nums">{formatSekShort(owedOrTotal(i))}</span>
                <InvoiceStatusBadge status={i.status} />
              </span>
            </PanelRow>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** Tenants who have left the lease, or will join it, with their dates. */
function PartyHistory({ lease, today }: { lease: LeaseView; today: string }) {
  const rows = lease.partyRows.filter(
    (p) => (p.toDate !== null && p.toDate < today) || p.fromDate > today,
  )
  if (rows.length === 0) return null
  return (
    <div className="grid gap-1 border-t pt-3 text-[13px]">
      <span className="font-medium text-muted-foreground">{m.lease_former_parties()}</span>
      {rows.map((p) => (
        <span key={p.id} className="flex justify-between gap-3">
          <span className="truncate">{p.name}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {p.fromDate > today
              ? m.lease_party_from({ date: p.fromDate })
              : m.lease_party_until({ date: p.toDate ?? '' })}
          </span>
        </span>
      ))}
    </div>
  )
}
