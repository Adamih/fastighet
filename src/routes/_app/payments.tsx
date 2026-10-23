import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import type { Effect } from 'effect'
import { useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { PaymentStatusBadge } from '#/features/payments/components'
import {
  assignPaymentFn,
  ignorePaymentFn,
  importPaymentsFn,
  openInvoicesQuery,
  paymentImportsQuery,
  paymentsQuery,
  undoPaymentFn,
} from '#/features/payments/functions'
import type { listPayments } from '#/features/payments/program'
import { type PaymentFilter, paymentFilters } from '#/features/payments/schemas'
import { formatSek } from '#/lib/money'
import { cn } from '#/lib/utils'

const filterLabels: Record<PaymentFilter, string> = {
  attention: 'Att hantera',
  matched: 'Matchade',
  ignored: 'Ignorerade',
  all: 'Alla',
}

export const Route = createFileRoute('/_app/payments')({
  // Optional so plain /payments stays clean; the default is what needs attention.
  validateSearch: (search): { filter?: PaymentFilter } => ({
    filter: paymentFilters.includes(search.filter as PaymentFilter)
      ? (search.filter as PaymentFilter)
      : undefined,
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter ?? 'attention' }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(paymentsQuery(deps.filter)),
      context.queryClient.ensureQueryData(paymentImportsQuery()),
    ]),
  component: PaymentsPage,
})

type ImportSummary = Awaited<ReturnType<typeof importPaymentsFn>>

function PaymentsPage() {
  const filter = Route.useSearch().filter ?? 'attention'
  const { data: payments } = useSuspenseQuery(paymentsQuery(filter))
  const { data: imports } = useSuspenseQuery(paymentImportsQuery())

  return (
    <div className="grid gap-8">
      <h1 className="font-semibold text-2xl">Betalningar</h1>
      <ImportForm />

      <section className="grid gap-4">
        <nav className="flex flex-wrap gap-2 text-sm">
          {paymentFilters.map((f) => (
            <Link
              key={f}
              to="/payments"
              search={f === 'attention' ? {} : { filter: f }}
              className={cn(
                'rounded-full border px-3 py-1',
                f === filter ? 'bg-foreground text-background' : 'text-muted-foreground',
              )}
            >
              {filterLabels[f]}
            </Link>
          ))}
        </nav>
        {payments.length === 0 ? (
          <p className="text-muted-foreground">
            {filter === 'attention' ? 'Inga betalningar att hantera.' : 'Inga betalningar.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Datum</th>
                <th className="py-2 font-medium">Betalare</th>
                <th className="py-2 font-medium">Referens</th>
                <th className="py-2 text-right font-medium">Belopp</th>
                <th className="py-2 pl-4 font-medium">Status</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <PaymentRow key={p.id} payment={p} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {imports.length > 0 && (
        <section className="grid gap-2">
          <h2 className="font-medium text-lg">Senaste importer</h2>
          <ul className="grid gap-1 text-sm">
            {imports.map((i) => (
              <li key={i.id} className="text-muted-foreground">
                {i.createdAt.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })} ·{' '}
                <span className="text-foreground">{i.fileName}</span> · {i.paymentCount}{' '}
                betalningar, {formatSek(i.totalOre)}
                {i.duplicateCount > 0 && ` · ${i.duplicateCount} redan importerade`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ImportForm() {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const upload = useMutation({
    mutationFn: async (file: File) =>
      importPaymentsFn({ data: { fileName: file.name, content: await file.text() } }),
    onSuccess: async (result) => {
      setSummary(result)
      if (input.current) input.current.value = ''
      await queryClient.invalidateQueries({ queryKey: ['payments'] })
      await queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })

  return (
    <section className="grid max-w-2xl gap-3 rounded-lg border p-6">
      <h2 className="font-medium text-lg">Importera betalningar</h2>
      <p className="text-muted-foreground text-sm">
        Ladda upp bankens fil med inbetalningar (camt.054, XML). Betalningar med rätt OCR-nummer och
        belopp bokas mot avin automatiskt. En fil kan importeras flera gånger utan dubbletter.
      </p>
      <input
        ref={input}
        type="file"
        accept=".xml,application/xml,text/xml"
        disabled={upload.isPending}
        className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
        onChange={(e) => {
          const file = e.target.files?.[0]
          setSummary(null)
          if (file) upload.mutate(file)
        }}
      />
      {upload.isPending && <p className="text-muted-foreground text-sm">Importerar…</p>}
      {upload.error && <p className="text-destructive text-sm">{upload.error.message}</p>}
      {summary && (
        <ul className="grid gap-0.5 text-sm">
          <li>{summary.imported} betalningar importerade</li>
          <li>{summary.matched} bokade mot avier</li>
          {summary.review > 0 && <li>{summary.review} att kontrollera</li>}
          {summary.unmatched > 0 && <li>{summary.unmatched} utan matchande avi</li>}
          {summary.duplicates > 0 && <li>{summary.duplicates} redan importerade, hoppades över</li>}
          {summary.skippedDebits + summary.skippedOtherCurrency > 0 && (
            <li className="text-muted-foreground">
              {summary.skippedDebits + summary.skippedOtherCurrency} utbetalningar eller poster i
              annan valuta ignorerades
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

type PaymentRowData = Effect.Success<ReturnType<typeof listPayments>>[number]

function PaymentRow({ payment }: { payment: PaymentRowData }) {
  const queryClient = useQueryClient()
  const [assigning, setAssigning] = useState(false)
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['payments'] })
    await queryClient.invalidateQueries({ queryKey: ['invoices'] })
  }
  const ignore = useMutation({ mutationFn: ignorePaymentFn, onSuccess: refresh })
  const undo = useMutation({ mutationFn: undoPaymentFn, onSuccess: refresh })
  const error = ignore.error ?? undo.error
  const open = payment.status === 'review' || payment.status === 'unmatched'

  return (
    <>
      <tr className="border-b align-top">
        <td className="py-2 tabular-nums">{payment.bookingDate}</td>
        <td className="py-2">{payment.payerName ?? '–'}</td>
        <td className="py-2 tabular-nums">{payment.reference ?? '–'}</td>
        <td className="py-2 text-right tabular-nums">{formatSek(payment.amountOre)}</td>
        <td className="grid gap-1 py-2 pl-4">
          <span>
            <PaymentStatusBadge status={payment.status} />
          </span>
          {payment.invoice && (
            <Link
              to="/invoices/$invoiceId"
              params={{ invoiceId: payment.invoice.id }}
              className="text-xs underline-offset-4 hover:underline"
            >
              Avi {payment.invoice.number} · {payment.invoice.recipientName}
            </Link>
          )}
          {payment.note && <span className="text-muted-foreground text-xs">{payment.note}</span>}
          {error && <span className="text-destructive text-xs">{error.message}</span>}
        </td>
        <td className="py-2 text-right">
          <span className="inline-flex gap-2">
            {open && (
              <>
                <Button variant="outline" size="sm" onClick={() => setAssigning(!assigning)}>
                  Koppla
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ignore.isPending}
                  onClick={() => ignore.mutate({ data: { paymentId: payment.id } })}
                >
                  Ignorera
                </Button>
              </>
            )}
            {!open && (
              <Button
                variant="outline"
                size="sm"
                disabled={undo.isPending}
                onClick={() => undo.mutate({ data: { paymentId: payment.id } })}
              >
                Ångra
              </Button>
            )}
          </span>
        </td>
      </tr>
      {open && assigning && (
        <tr className="border-b bg-muted/40">
          <td colSpan={6} className="p-3">
            <AssignToInvoice
              paymentId={payment.id}
              suggestedInvoiceId={payment.invoiceId}
              onDone={async () => {
                setAssigning(false)
                await refresh()
              }}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function AssignToInvoice({
  paymentId,
  suggestedInvoiceId,
  onDone,
}: {
  paymentId: string
  suggestedInvoiceId: string | null
  onDone: () => Promise<void>
}) {
  const { data: invoices, isPending } = useQuery(openInvoicesQuery())
  const [invoiceId, setInvoiceId] = useState(suggestedInvoiceId ?? '')
  const assign = useMutation({ mutationFn: assignPaymentFn, onSuccess: onDone })

  if (isPending) return <p className="text-muted-foreground text-sm">Hämtar avier…</p>
  if (!invoices || invoices.length === 0) {
    return <p className="text-sm">Det finns inga obetalda avier att koppla till.</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={invoiceId || undefined} onValueChange={setInvoiceId}>
        <SelectTrigger className="w-96" aria-label="Avi att koppla till">
          <SelectValue placeholder="Välj avi" />
        </SelectTrigger>
        <SelectContent>
          {invoices.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              Avi {i.number} · {i.recipientName} · {formatSek(i.totalOre)} · OCR {i.ocr}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!invoiceId || assign.isPending}
        onClick={() => assign.mutate({ data: { paymentId, invoiceId } })}
      >
        Koppla och markera betald
      </Button>
      {assign.error && <span className="text-destructive text-sm">{assign.error.message}</span>}
    </div>
  )
}
