import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import {
  emailInvoiceFn,
  invoiceQuery,
  markInvoicePaidFn,
  unmarkInvoicePaidFn,
  voidInvoiceFn,
} from '#/features/invoicing/functions'
import type { InvoiceView } from '#/features/invoicing/program'
import { periodLabel, vatNumberFor } from '#/features/invoicing/rules'
import { stockholmDate } from '#/lib/dates'
import { formatSek } from '#/lib/money'

export const Route = createFileRoute('/_app/invoices/$invoiceId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(invoiceQuery(params.invoiceId)),
  component: InvoicePage,
})

function InvoicePage() {
  const { invoiceId } = Route.useParams()
  const { data: invoice } = useSuspenseQuery(invoiceQuery(invoiceId))

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/invoices" className="text-muted-foreground text-sm hover:underline">
          ← Avier
        </Link>
        <InvoiceStatusBadge status={invoice.status} />
        {invoice.sentAt && (
          <span className="text-muted-foreground text-sm">
            Skickad {stockholmDate(invoice.sentAt.getTime())} till {invoice.recipientEmail}
          </span>
        )}
      </div>
      <InvoiceActions invoice={invoice} />
      <PrintableInvoice invoice={invoice} />
    </div>
  )
}

function InvoiceActions({ invoice }: { invoice: InvoiceView }) {
  const queryClient = useQueryClient()
  const [paidOn, setPaidOn] = useState(() => stockholmDate(Date.now()))
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const onDone = async () => {
    await queryClient.invalidateQueries({ queryKey: ['invoices'] })
  }
  const email = useMutation({
    mutationFn: emailInvoiceFn,
    onSuccess: async () => {
      setNotice(`Skickad till ${invoice.recipientEmail}`)
      await onDone()
    },
  })
  const pay = useMutation({ mutationFn: markInvoicePaidFn, onSuccess: onDone })
  const unpay = useMutation({ mutationFn: unmarkInvoicePaidFn, onSuccess: onDone })
  const voidIt = useMutation({ mutationFn: voidInvoiceFn, onSuccess: onDone })
  const error = email.error ?? pay.error ?? unpay.error ?? voidIt.error
  const data = { invoiceId: invoice.id }
  const open = invoice.status === 'unpaid' || invoice.status === 'overdue'

  return (
    <section className="grid gap-3 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="outline" onClick={() => window.print()}>
          Skriv ut
        </Button>
        {invoice.status !== 'void' && invoice.recipientEmail && (
          <Button
            variant="outline"
            disabled={email.isPending}
            onClick={() => email.mutate({ data })}
          >
            {invoice.sentAt ? 'Skicka igen' : 'Skicka e-post'}
          </Button>
        )}
        {open && (
          <div className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="paidOn">Betald den</Label>
              <Input
                id="paidOn"
                type="date"
                value={paidOn}
                className="w-40"
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </div>
            <Button
              disabled={pay.isPending}
              onClick={() => pay.mutate({ data: { ...data, paidOn } })}
            >
              Registrera betalning
            </Button>
          </div>
        )}
        {invoice.status === 'paid' && (
          <Button
            variant="outline"
            disabled={unpay.isPending}
            onClick={() => unpay.mutate({ data })}
          >
            Ångra betalning ({invoice.paidOn})
          </Button>
        )}
        {open &&
          (confirmVoid ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-sm">Makulera avi {invoice.number}?</span>
              <Button
                variant="destructive"
                disabled={voidIt.isPending}
                onClick={() => voidIt.mutate({ data })}
              >
                Makulera
              </Button>
              <Button variant="outline" onClick={() => setConfirmVoid(false)}>
                Avbryt
              </Button>
            </span>
          ) : (
            <Button variant="outline" onClick={() => setConfirmVoid(true)}>
              Makulera
            </Button>
          ))}
      </div>
      {notice && !error && (
        <p className="text-emerald-700 text-sm dark:text-emerald-300">{notice}</p>
      )}
      {error && <p className="text-destructive text-sm">{error.message}</p>}
    </section>
  )
}

/** The invoice as printed or saved as PDF from the browser. */
function PrintableInvoice({ invoice }: { invoice: InvoiceView }) {
  const { seller } = invoice
  const hasVat = invoice.vatOre > 0
  const period = periodLabel({ start: invoice.periodStart, end: invoice.periodEnd })

  return (
    <article className="grid max-w-3xl gap-8 rounded-lg border p-8 print:border-0 print:p-0">
      <header className="flex flex-wrap justify-between gap-6">
        <div>
          <p className="font-semibold text-lg">{seller.organizationName}</p>
          <p className="text-muted-foreground text-sm">
            {seller.streetAddress}
            {seller.streetAddress && <br />}
            {[seller.postalCode, seller.city].filter(Boolean).join(' ')}
          </p>
        </div>
        <div className="text-right">
          <h1 className="font-semibold text-2xl">
            Hyresavi{invoice.status === 'void' && ' (makulerad)'}
          </h1>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 text-sm">
            <dt className="text-muted-foreground">Fakturanummer</dt>
            <dd className="tabular-nums">{invoice.number}</dd>
            <dt className="text-muted-foreground">Fakturadatum</dt>
            <dd className="tabular-nums">{invoice.issueDate}</dd>
            <dt className="text-muted-foreground">Avtal</dt>
            <dd className="tabular-nums">{invoice.lease.number}</dd>
          </dl>
        </div>
      </header>

      <section className="text-sm">
        <p className="font-medium">{invoice.recipientName}</p>
        <p>{invoice.recipientStreetAddress}</p>
        <p>{[invoice.recipientPostalCode, invoice.recipientCity].filter(Boolean).join(' ')}</p>
      </section>

      <table className="w-full text-left text-sm">
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="py-2 font-medium">Beskrivning</th>
            {hasVat && <th className="py-2 text-right font-medium">Moms</th>}
            <th className="py-2 text-right font-medium">Belopp</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-b">
              <td className="py-2">{line.description}</td>
              {hasVat && <td className="py-2 text-right">{line.vatRatePercent} %</td>}
              <td className="py-2 text-right tabular-nums">{formatSek(line.netOre)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {hasVat && (
            <>
              <tr>
                <td className="pt-2" colSpan={2}>
                  Summa exkl. moms
                </td>
                <td className="pt-2 text-right tabular-nums">{formatSek(invoice.netOre)}</td>
              </tr>
              <tr>
                <td colSpan={2}>Moms 25 %</td>
                <td className="text-right tabular-nums">{formatSek(invoice.vatOre)}</td>
              </tr>
            </>
          )}
          <tr className="font-semibold">
            <td className="pt-2" colSpan={hasVat ? 2 : 1}>
              Att betala
            </td>
            <td className="pt-2 text-right tabular-nums">{formatSek(invoice.totalOre)}</td>
          </tr>
        </tfoot>
      </table>

      <section className="grid gap-x-8 gap-y-1 rounded-md bg-muted p-4 text-sm sm:grid-cols-4">
        <PaymentField label="Bankgiro" value={seller.bankgiro ?? '–'} />
        <PaymentField label="OCR-nummer" value={invoice.ocr} />
        <PaymentField label="Förfallodag" value={invoice.dueDate} />
        <PaymentField label="Belopp" value={formatSek(invoice.totalOre)} />
      </section>

      <footer className="text-muted-foreground text-xs">
        Hyra för {period}. Ange OCR-numret vid betalning.
        <br />
        {[
          seller.organizationNumber && `Org.nr ${seller.organizationNumber}`,
          hasVat &&
            seller.organizationNumber &&
            `Momsreg.nr ${vatNumberFor(seller.organizationNumber)}`,
          seller.fSkatt && 'Godkänd för F-skatt',
          seller.email,
          seller.phone,
        ]
          .filter(Boolean)
          .join(' · ')}
      </footer>
    </article>
  )
}

function PaymentField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  )
}
