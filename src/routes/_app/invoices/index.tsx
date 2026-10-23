import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Check, Plus } from 'lucide-react'
import {
  FilterChips,
  filterChipClass,
  filterTabClass,
  PageHeader,
  StatCard,
} from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { invoicesQuery, markInvoicePaidFn } from '#/features/invoicing/functions'
import {
  dueNote,
  invoiceCount,
  invoiceOverview,
  matchesFilter,
} from '#/features/invoicing/overview'
import { periodLabel } from '#/features/invoicing/rules'
import { type InvoiceFilter, invoiceFilters } from '#/features/invoicing/schemas'
import { unitSummary } from '#/features/leases/overview'
import { isIsoDate, stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'

const filterLabels: Record<InvoiceFilter, string> = {
  all: 'Alla',
  unpaid: 'Obetalda',
  overdue: 'Förfallna',
  paid: 'Betalda',
  void: 'Makulerade',
}

export const Route = createFileRoute('/_app/invoices/')({
  // Optional so plain /invoices stays a clean URL; missing or unknown means "all".
  // `period` is the first day of an invoice period.
  validateSearch: (search): { filter?: InvoiceFilter; period?: string } => ({
    filter: invoiceFilters.includes(search.filter as InvoiceFilter)
      ? (search.filter as InvoiceFilter)
      : undefined,
    period:
      typeof search.period === 'string' && isIsoDate(search.period) ? search.period : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(invoicesQuery({ filter: 'all' })),
  component: InvoicesPage,
})

type Invoice = (typeof Route.types.loaderData)[number]

function InvoicesPage() {
  const can = useCan()
  const canCreate = can({ invoice: ['manage'], lease: ['read'] })
  const canManage = can({ invoice: ['manage'] })
  const search = Route.useSearch()
  const filter = search.filter ?? 'all'
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: invoices } = useSuspenseQuery(invoicesQuery({ filter: 'all' }))
  const today = stockholmDate(Date.now())

  const inPeriod = invoices.filter((i) => !search.period || i.periodStart === search.period)
  const overview = invoiceOverview(inPeriod, today)
  const visible = inPeriod.filter((i) => matchesFilter(i.status, filter))
  const visibleOutstanding = invoiceOverview(visible, today).outstanding.totalOre
  const periods = [...new Map(invoices.map((i) => [i.periodStart, i])).values()]
    .map((i) => ({
      start: i.periodStart,
      label: periodLabel({ start: i.periodStart, end: i.periodEnd }),
    }))
    .sort((a, b) => b.start.localeCompare(a.start))
  const tabs = invoiceFilters.filter((f) => f !== 'void' || overview.counts.void > 0)

  const queryClient = useQueryClient()
  const pay = useMutation({
    mutationFn: markInvoicePaidFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  })
  const markPaid = (invoiceId: string) => pay.mutate({ data: { invoiceId, paidOn: today } })
  const actions = { canManage, markPaid, busy: pay.isPending }

  const filterSearch = (f: InvoiceFilter) => ({
    ...(f === 'all' ? {} : { filter: f }),
    ...(search.period ? { period: search.period } : {}),
  })

  return (
    <div className="grid gap-6 md:gap-7">
      <PageHeader
        title="Avier"
        subtitle="Hyresavier och betalningsstatus"
        action={
          canCreate && (
            <Button asChild className="h-11 md:h-10">
              <Link to="/invoices/new">
                <Plus aria-hidden="true" />
                <span>
                  Skapa<span className="sr-only sm:not-sr-only"> avier</span>
                </span>
              </Link>
            </Button>
          )
        }
      />

      <section
        aria-label="Sammanfattning"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4"
      >
        <StatCard label="Utestående" hint={invoiceCount(overview.outstanding.count)}>
          {formatSekShort(overview.outstanding.totalOre)}
        </StatCard>
        <StatCard
          label="Förfallet"
          tone={overview.overdue.count > 0 ? 'danger' : 'default'}
          hint={
            overview.overdue.oldestDays !== null
              ? `${invoiceCount(overview.overdue.count)} · äldsta ${overview.overdue.oldestDays} dagar sen`
              : 'Inget förfallet'
          }
        >
          {formatSekShort(overview.overdue.totalOre)}
        </StatCard>
        <StatCard
          label="Betalt"
          hint={invoiceCount(overview.paid.count)}
          className="hidden md:grid"
        >
          {formatSekShort(overview.paid.totalOre)}
        </StatCard>
      </section>

      {invoices.length === 0 ? (
        <p className="text-muted-foreground">Inga avier ännu.</p>
      ) : (
        <>
          {/* Phone: chips and cards. */}
          <div className="grid gap-3 md:hidden">
            <FilterChips label="Filtrera avier">
              {tabs.map((f) => (
                <Link
                  key={f}
                  to="/invoices"
                  search={filterSearch(f)}
                  aria-current={f === filter ? 'page' : undefined}
                  className={filterChipClass(f === filter)}
                >
                  {filterLabels[f]} <span className="tabular-nums">{overview.counts[f]}</span>
                </Link>
              ))}
            </FilterChips>
            {visible.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground text-sm">Inga avier matchar.</p>
            ) : (
              <ul className="grid gap-3">
                {visible.map((invoice) => (
                  <InvoiceCard key={invoice.id} invoice={invoice} {...actions} />
                ))}
              </ul>
            )}
            {visibleOutstanding > 0 && (
              <p className="text-center text-[13px] text-muted-foreground tabular-nums">
                Utestående i listan:{' '}
                <strong className="text-foreground">{formatSekShort(visibleOutstanding)}</strong>
              </p>
            )}
          </div>

          {/* Desktop: one card with tabs, period filter and the table. */}
          <section className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5">
              <nav aria-label="Filtrera avier" className="flex flex-wrap gap-1">
                {tabs.map((f) => (
                  <Link
                    key={f}
                    to="/invoices"
                    search={filterSearch(f)}
                    aria-current={f === filter ? 'page' : undefined}
                    className={filterTabClass(f === filter)}
                  >
                    {filterLabels[f]} <span className="tabular-nums">{overview.counts[f]}</span>
                  </Link>
                ))}
              </nav>
              {periods.length > 1 && (
                <label className="flex h-9 items-center gap-2 rounded-lg border bg-background pl-3 text-[13px] text-muted-foreground">
                  Period
                  <select
                    value={search.period ?? ''}
                    onChange={(e) =>
                      navigate({
                        search: (prev) => ({ ...prev, period: e.target.value || undefined }),
                      })
                    }
                    className="h-full rounded-r-lg bg-transparent pr-2 font-medium text-foreground outline-none"
                  >
                    <option value="">Alla perioder</option>
                    {periods.map((p) => (
                      <option key={p.start} value={p.start}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-muted-foreground text-sm">
                Inga avier matchar.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px] lg:text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className={cn(th, 'w-0')}>Nr</th>
                      <th className={th}>Hyresgäst</th>
                      <th className={cn(th, 'hidden lg:table-cell')}>Period</th>
                      <th className={th}>Förfallodag</th>
                      <th className={cn(th, 'text-right')}>Belopp</th>
                      <th className={th}>Status</th>
                      <th className={cn(th, 'hidden lg:table-cell')}>Skickad</th>
                      {canManage && (
                        <th className={cn(th, 'text-right')}>
                          <span className="sr-only">Åtgärd</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((invoice) => (
                      <InvoiceRow key={invoice.id} invoice={invoice} today={today} {...actions} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground">
              <span>
                Visar {visible.length} av {invoiceCount(invoices.length)}
              </span>
              {visibleOutstanding > 0 && (
                <span>
                  Utestående i listan:{' '}
                  <strong className="text-foreground tabular-nums">
                    {formatSekShort(visibleOutstanding)}
                  </strong>
                </span>
              )}
            </div>
          </section>
          {pay.error && <p className="text-destructive text-sm">{pay.error.message}</p>}
        </>
      )}
    </div>
  )
}

const th = 'whitespace-nowrap px-2.5 py-2.5 font-semibold lg:px-4 lg:py-3'
const td = 'px-2.5 py-3 lg:px-4 lg:py-3.5'

const isOpen = (invoice: Invoice) => invoice.status === 'unpaid' || invoice.status === 'overdue'

/** "Uppsala Kungsängen 12:3 · Lgh 1001", empty when the units aren't shown. */
function objectLine(invoice: Invoice) {
  const units = unitSummary(invoice.units)
  return [units.designations, units.labels.join(', ')].filter(Boolean).join(' · ')
}

interface RowProps {
  invoice: Invoice
  today: string
  canManage: boolean
  busy: boolean
  markPaid: (invoiceId: string) => void
}

function InvoiceRow({ invoice, today, canManage, busy, markPaid }: RowProps) {
  const overdue = invoice.status === 'overdue'
  const note = dueNote(invoice, today)
  const period = periodLabel({ start: invoice.periodStart, end: invoice.periodEnd })
  const objects = objectLine(invoice)
  return (
    <tr
      className={cn(
        'border-b last:border-b-0',
        overdue && 'bg-destructive/5 shadow-[inset_3px_0_0_var(--destructive)]',
      )}
    >
      <td className={cn(td, 'text-muted-foreground tabular-nums')}>{invoice.number}</td>
      <td className={td}>
        <div className="grid gap-0.5">
          <Link
            to="/invoices/$invoiceId"
            params={{ invoiceId: invoice.id }}
            className="font-semibold underline-offset-4 hover:underline"
          >
            {invoice.recipientName}
          </Link>
          {objects && (
            <span className="whitespace-nowrap text-muted-foreground text-xs">{objects}</span>
          )}
          {/* Below lg the period and sent columns fold in here. */}
          <span className="whitespace-nowrap text-muted-foreground text-xs lg:hidden">
            {period}
            {invoice.sentAt && ' · skickad'}
          </span>
        </div>
      </td>
      <td className={cn(td, 'hidden whitespace-nowrap lg:table-cell')}>{period}</td>
      <td className={cn(td, 'tabular-nums')}>
        <div className="grid gap-0.5">
          <span className="whitespace-nowrap">{invoice.dueDate}</span>
          {note && (
            <span
              className={cn(
                'whitespace-nowrap text-xs',
                overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {note}
            </span>
          )}
        </div>
      </td>
      <td className={cn(td, 'whitespace-nowrap text-right font-semibold tabular-nums')}>
        {formatSekShort(invoice.totalOre)}
      </td>
      <td className={td}>
        <InvoiceStatusBadge status={invoice.status} />
      </td>
      <td className={cn(td, 'hidden lg:table-cell')}>
        {invoice.sentAt ? (
          <span className="inline-flex items-center gap-1.5 text-[13px]">
            <Check aria-hidden="true" className="size-3.5 text-emerald-600" />
            Ja
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      {canManage && (
        <td className={cn(td, 'text-right')}>
          {isOpen(invoice) && (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 px-2.5 text-[13px]"
              disabled={busy}
              onClick={() => markPaid(invoice.id)}
              aria-label={`Markera avi ${invoice.number} betald i dag`}
            >
              Markera betald
            </Button>
          )}
        </td>
      )}
    </tr>
  )
}

function InvoiceCard({ invoice, canManage, busy, markPaid }: Omit<RowProps, 'today'>) {
  const overdue = invoice.status === 'overdue'
  const period = periodLabel({ start: invoice.periodStart, end: invoice.periodEnd })
  return (
    <li
      className={cn(
        'overflow-hidden rounded-xl border bg-card',
        overdue && 'border-destructive/30',
      )}
    >
      <Link
        to="/invoices/$invoiceId"
        params={{ invoiceId: invoice.id }}
        className={cn(
          'grid gap-3 p-4 text-foreground hover:bg-muted/40 hover:text-foreground',
          overdue && 'shadow-[inset_3px_0_0_var(--destructive)]',
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate font-semibold text-base">{invoice.recipientName}</span>
            <span className="truncate text-[13px] text-muted-foreground">
              Avi #{invoice.number} · {period}
            </span>
          </span>
          <InvoiceStatusBadge status={invoice.status} />
        </span>
        <span className="flex items-end justify-between gap-3 text-[13px] tabular-nums">
          <span className="grid min-w-0 gap-0.5">
            <span>
              {overdue ? 'Förföll' : 'Förfaller'} {invoice.dueDate}
            </span>
            <span className="text-muted-foreground">
              {invoice.sentAt ? 'Skickad ✓ via e-post' : 'Inte skickad'}
            </span>
          </span>
          <span className="shrink-0 font-bold text-xl">{formatSekShort(invoice.totalOre)}</span>
        </span>
      </Link>
      {canManage && isOpen(invoice) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => markPaid(invoice.id)}
          aria-label={`Markera avi ${invoice.number} betald i dag`}
          className="h-12 w-full border-t font-semibold text-primary text-sm hover:bg-muted/40 disabled:opacity-50"
        >
          Markera betald
        </button>
      )}
    </li>
  )
}
