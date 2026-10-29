import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { formatShortDate } from '#/features/leases/overview'
import { PortalInvoiceRow } from '#/features/portal/components'
import { portalBalanceQuery, portalInvoicesQuery } from '#/features/portal/portal-functions'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/portal/_portal/')({
  loader: ({ context }) =>
    context.portal.company
      ? Promise.all([
          context.queryClient.ensureQueryData(portalBalanceQuery()),
          context.queryClient.ensureQueryData(portalInvoicesQuery()),
        ])
      : null,
  component: PortalOverview,
})

/** Mina sidor's start: who the pages are for, what is due next and the latest avi. */
function PortalOverview() {
  const { portal } = Route.useRouteContext()
  const company = portal.company
  if (!company) return null
  return (
    <div className="grid gap-5">
      <header className="grid gap-1">
        <h1 className="font-bold text-2xl tracking-tight md:text-3xl">
          {m.portal_greeting({ name: portal.user.name || portal.user.email })}
        </h1>
        <p className="text-muted-foreground text-sm">
          {m.portal_overview_for({
            parties: company.parties.map((p) => p.name).join(', '),
            company: company.name,
          })}
        </p>
      </header>
      <MoneySummary />
    </div>
  )
}

function MoneySummary() {
  const { data: balance } = useSuspenseQuery(portalBalanceQuery())
  const { data: invoices } = useSuspenseQuery(portalInvoicesQuery())
  const latest = invoices[0]
  return (
    <>
      <section className="grid gap-1 rounded-xl border bg-card p-4">
        <span className="text-muted-foreground text-sm">{m.portal_balance_owed()}</span>
        <span className="font-bold text-3xl tabular-nums">{formatSek(balance.owedOre)}</span>
        {balance.nextDue ? (
          <span className="text-sm">
            {m.portal_next_due({
              amount: formatSek(balance.nextDue.owedOre),
              date: formatShortDate(balance.nextDue.dueDate),
            })}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{m.portal_nothing_due()}</span>
        )}
        {balance.overdueOre > 0 && (
          <span className="text-destructive text-sm">
            {m.portal_balance_overdue({ amount: formatSek(balance.overdueOre) })}
          </span>
        )}
        {balance.creditOre > 0 && (
          <span className="text-emerald-700 text-sm dark:text-emerald-300">
            {m.portal_credit_line({ amount: formatSek(balance.creditOre) })}
          </span>
        )}
      </section>
      {latest && (
        <section className="grid gap-1 rounded-xl border bg-card px-3 py-2">
          <div className="flex items-center justify-between px-1 pt-1">
            <h2 className="font-semibold">{m.portal_latest_invoice()}</h2>
            <Link
              to="/portal/avier"
              search={{ filter: 'all' }}
              className="text-sm underline-offset-4 hover:underline"
            >
              {m.portal_all_invoices()}
            </Link>
          </div>
          <PortalInvoiceRow invoice={latest} />
        </section>
      )}
    </>
  )
}
