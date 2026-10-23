import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { invoicesQuery } from '#/features/invoicing/functions'
import { periodLabel } from '#/features/invoicing/rules'
import { type InvoiceFilter, invoiceFilters } from '#/features/invoicing/schemas'
import { formatSek } from '#/lib/money'
import { cn } from '#/lib/utils'

const filterLabels: Record<InvoiceFilter, string> = {
  all: 'Alla',
  unpaid: 'Obetalda',
  overdue: 'Förfallna',
  paid: 'Betalda',
  void: 'Makulerade',
}

export const Route = createFileRoute('/_app/invoices/')({
  // Optional so plain /invoices stays a clean URL; a missing or unknown filter means "all".
  validateSearch: (search): { filter?: InvoiceFilter } => ({
    filter: invoiceFilters.includes(search.filter as InvoiceFilter)
      ? (search.filter as InvoiceFilter)
      : undefined,
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter ?? 'all' }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(invoicesQuery({ filter: deps.filter })),
  component: InvoicesPage,
})

function InvoicesPage() {
  const canCreate = useCan()({ invoice: ['manage'], lease: ['read'] })
  const filter = Route.useSearch().filter ?? 'all'
  const { data: invoices } = useSuspenseQuery(invoicesQuery({ filter }))
  const outstanding = invoices
    .filter((i) => i.status === 'unpaid' || i.status === 'overdue')
    .reduce((sum, i) => sum + i.totalOre, 0)

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl">Avier</h1>
        {canCreate && (
          <Button asChild>
            <Link to="/invoices/new">Skapa avier</Link>
          </Button>
        )}
      </div>

      <nav className="flex flex-wrap gap-2 text-sm">
        {invoiceFilters.map((f) => (
          <Link
            key={f}
            to="/invoices"
            search={f === 'all' ? {} : { filter: f }}
            className={cn(
              'rounded-full border px-3 py-1',
              f === filter ? 'bg-foreground text-background' : 'text-muted-foreground',
            )}
          >
            {filterLabels[f]}
          </Link>
        ))}
      </nav>

      {invoices.length === 0 ? (
        <p className="text-muted-foreground">Inga avier.</p>
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Nr</th>
                <th className="py-2 font-medium">Hyresgäst</th>
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 font-medium">Förfallodag</th>
                <th className="py-2 text-right font-medium">Belopp</th>
                <th className="py-2 pl-4 font-medium">Status</th>
                <th className="py-2 font-medium">Skickad</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b">
                  <td className="py-2 tabular-nums">
                    <Link
                      to="/invoices/$invoiceId"
                      params={{ invoiceId: i.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {i.number}
                    </Link>
                  </td>
                  <td className="py-2">{i.recipientName}</td>
                  <td className="py-2">
                    {periodLabel({ start: i.periodStart, end: i.periodEnd })}
                  </td>
                  <td className="py-2 tabular-nums">{i.dueDate}</td>
                  <td className="py-2 text-right tabular-nums">{formatSek(i.totalOre)}</td>
                  <td className="py-2 pl-4">
                    <InvoiceStatusBadge status={i.status} />
                  </td>
                  <td className="py-2 text-muted-foreground">{i.sentAt ? 'Ja' : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {outstanding > 0 && (
            <p className="text-sm">
              Utestående i listan:{' '}
              <span className="font-medium tabular-nums">{formatSek(outstanding)}</span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
