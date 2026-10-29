import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { FilterChips, filterChipClass } from '#/components/responsive'
import { PortalInvoiceRow } from '#/features/portal/components'
import { portalBalanceQuery, portalInvoicesQuery } from '#/features/portal/portal-functions'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

type Filter = 'open' | 'all'

export const Route = createFileRoute('/portal/_portal/avier/')({
  validateSearch: (search): { filter?: Filter } => ({
    filter: search.filter === 'all' ? 'all' : undefined,
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(portalInvoicesQuery()),
      context.queryClient.ensureQueryData(portalBalanceQuery()),
    ]),
  component: PortalInvoicesPage,
})

function PortalInvoicesPage() {
  const { filter = 'open' } = Route.useSearch()
  const { data: invoices } = useSuspenseQuery(portalInvoicesQuery())
  const { data: balance } = useSuspenseQuery(portalBalanceQuery())
  const shown =
    filter === 'all'
      ? invoices
      : invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue')

  return (
    <div className="grid gap-5">
      <h1 className="font-bold text-2xl tracking-tight md:text-3xl">{m.portal_nav_invoices()}</h1>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1 rounded-xl border bg-card p-4">
          <span className="text-muted-foreground text-sm">{m.portal_balance_owed()}</span>
          <span className="font-bold text-2xl tabular-nums">{formatSek(balance.owedOre)}</span>
          {balance.overdueOre > 0 && (
            <span className="text-destructive text-sm">
              {m.portal_balance_overdue({ amount: formatSek(balance.overdueOre) })}
            </span>
          )}
        </div>
        <div className="grid gap-1 rounded-xl border bg-card p-4">
          <span className="text-muted-foreground text-sm">{m.portal_balance_credit()}</span>
          <span className="font-bold text-2xl tabular-nums">{formatSek(balance.creditOre)}</span>
          <span className="text-muted-foreground text-sm">{m.portal_balance_credit_hint()}</span>
        </div>
      </section>
      <FilterChips label={m.portal_nav_invoices()}>
        {(['open', 'all'] as const).map((value) => (
          <Link
            key={value}
            to="/portal/avier"
            search={{ filter: value === 'all' ? 'all' : undefined }}
            className={filterChipClass(filter === value)}
          >
            {value === 'all' ? m.portal_filter_all() : m.portal_filter_open()}
          </Link>
        ))}
      </FilterChips>
      <section className="rounded-xl border bg-card px-3 py-1">
        {shown.length === 0 ? (
          <p className="py-4 text-muted-foreground text-sm">
            {filter === 'open' ? m.portal_invoices_none_open() : m.portal_invoices_none()}
          </p>
        ) : (
          shown.map((invoice) => <PortalInvoiceRow key={invoice.id} invoice={invoice} />)
        )}
      </section>
    </div>
  )
}
