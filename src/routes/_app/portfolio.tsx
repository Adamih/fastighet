import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import {
  desktopTableClass,
  MobileList,
  MobileListLink,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
import { portfolioQuery } from '#/features/portfolio/functions'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

// "Alla bolag": the user's own company and every company they manage, with figures per company
// and the overdue avier and waiting payments of all of them. Read only: every row opens its
// company, where the work is done.
export const Route = createFileRoute('/_app/portfolio')({
  beforeLoad: ({ context }) => {
    if (context.app.organization.grant) {
      throw redirect({ to: '/portfolio', search: { company: undefined } })
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(portfolioQuery()),
  component: PortfolioPage,
})

type Portfolio = typeof Route.types.loaderData

function PortfolioPage() {
  const { app } = Route.useRouteContext()
  const { data } = useSuspenseQuery(portfolioQuery())
  const focus = (id: string) => (id === app.home.id ? undefined : id)
  const total = (pick: (c: Portfolio['companies'][number]) => number | undefined) =>
    data.companies.reduce((sum, c) => sum + (pick(c) ?? 0), 0)
  const shown = (rows: number, all: number) =>
    all > rows && (
      <p className="border-t px-5 py-3 text-muted-foreground text-xs">
        {m.portfolio_shown({ count: String(rows) })}
      </p>
    )

  return (
    <div className="grid gap-6 md:gap-7">
      <PageHeader
        title={m.nav_portfolio()}
        subtitle={m.portfolio_subtitle({ organization: app.home.name })}
      />
      <Companies companies={data.companies} focus={focus} />
      <section aria-labelledby="overdue" className="overflow-hidden rounded-xl border bg-card">
        <h2 id="overdue" className="border-b px-5 py-4 font-bold text-[15px]">
          {m.portfolio_overdue_title()}
        </h2>
        {data.overdue.length === 0 ? (
          <p className="px-5 py-4 text-muted-foreground text-sm">{m.portfolio_overdue_empty()}</p>
        ) : (
          <ul className="divide-y">
            {data.overdue.map((i) => (
              <li key={i.id}>
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: i.id }}
                  search={{ company: focus(i.company.id) }}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium text-sm">
                      {i.recipientName} · {m.portfolio_avi({ number: String(i.number) })}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {[
                        i.company.name,
                        m.portfolio_due({ date: i.dueDate }),
                        i.lastRemindedOn ? m.portfolio_reminded({ date: i.lastRemindedOn }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-sm tabular-nums">
                    {formatSek(i.owedOre)}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {shown(
          data.overdue.length,
          total((c) => c.overdue?.count),
        )}
      </section>
      <section aria-labelledby="attention" className="overflow-hidden rounded-xl border bg-card">
        <h2 id="attention" className="border-b px-5 py-4 font-bold text-[15px]">
          {m.portfolio_attention_title()}
        </h2>
        {data.attention.length === 0 ? (
          <p className="px-5 py-4 text-muted-foreground text-sm">{m.portfolio_attention_empty()}</p>
        ) : (
          <ul className="divide-y">
            {data.attention.map((p) => (
              <li key={p.id}>
                <Link
                  to="/payments"
                  search={{ company: focus(p.company.id), filter: 'attention' }}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium text-sm">
                      {p.payerName ?? m.portfolio_payment_unknown()}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {[p.company.name, p.bookingDate, p.reference].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-sm tabular-nums">
                    {formatSek(p.amountOre)}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {shown(
          data.attention.length,
          total((c) => c.attention?.count),
        )}
      </section>
    </div>
  )
}

const figure = (value: string | null) => value ?? m.portfolio_no_access()

function Companies({
  companies,
  focus,
}: {
  companies: Portfolio['companies']
  focus: (id: string) => string | undefined
}) {
  const overdue = (c: Portfolio['companies'][number]) =>
    figure(c.overdue && `${c.overdue.count} · ${formatSek(c.overdue.owedOre)}`)
  const attention = (c: Portfolio['companies'][number]) =>
    figure(c.attention && `${c.attention.count} · ${formatSek(c.attention.amountOre)}`)
  return (
    <section
      aria-label={m.portfolio_company()}
      className="overflow-hidden rounded-xl border bg-card"
    >
      <table className={desktopTableClass}>
        <thead className="border-b text-muted-foreground text-xs">
          <tr>
            <th className="px-5 py-3 font-medium">{m.portfolio_company()}</th>
            <th className="px-3 py-3 text-right font-medium">{m.portfolio_units()}</th>
            <th className="px-3 py-3 text-right font-medium">{m.portfolio_overdue()}</th>
            <th className="px-3 py-3 text-right font-medium">{m.portfolio_attention()}</th>
            <th className="px-5 py-3">
              <span className="sr-only">{m.portfolio_open()}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {companies.map((c) => (
            <tr key={c.id}>
              <td className="px-5 py-3">
                <span className="grid">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {c.managed ? m.portfolio_managed() : m.portfolio_own()}
                  </span>
                </span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {figure(c.units === null ? null : String(c.units))}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{overdue(c)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{attention(c)}</td>
              <td className="px-5 py-3 text-right">
                <Link
                  to="/"
                  search={{ company: focus(c.id) }}
                  className="font-medium text-sm underline-offset-4 hover:underline"
                >
                  {m.portfolio_open()}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <MobileList className="rounded-none border-0">
        {companies.map((c) => (
          <li key={c.id}>
            <MobileListLink to="/" search={{ company: focus(c.id) }}>
              <RowTitle end={c.managed ? m.portfolio_managed() : m.portfolio_own()}>
                {c.name}
              </RowTitle>
              <RowMeta>
                {m.portfolio_overdue()}: {overdue(c)}
              </RowMeta>
              <RowMeta>
                {m.portfolio_attention()}: {attention(c)}
              </RowMeta>
            </MobileListLink>
          </li>
        ))}
      </MobileList>
    </section>
  )
}
