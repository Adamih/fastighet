import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Banknote, Check, Printer, Send, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { DetailColumns, DetailHeader, FactList, Panel } from '#/components/detail'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useCan } from '#/features/auth/use-can'
import {
  creditNoteQuery,
  emailCreditNoteFn,
  refundCreditNoteFn,
  undoCreditNoteRefundFn,
} from '#/features/invoicing/functions'
import type { CreditNoteView } from '#/features/invoicing/program'
import { periodLabel } from '#/features/invoicing/rules'
import { sellerDetails } from '#/features/settings/seller'
import { stockholmDate } from '#/lib/dates'
import { formatSek, formatSekShort } from '#/lib/money'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/credit-notes/$creditNoteId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(creditNoteQuery(params.creditNoteId)),
  component: CreditNotePage,
})

function CreditNotePage() {
  const { creditNoteId } = Route.useParams()
  const { data: note } = useSuspenseQuery(creditNoteQuery(creditNoteId))
  const can = useCan()
  const canManage = can({ invoice: ['manage'] })
  const canRefund = can({ invoice: ['manage'], payment: ['manage'] })
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const email = useMutation({
    mutationFn: emailCreditNoteFn,
    onSuccess: async () => {
      setNotice(m.invoice_sent_to({ email: note.recipientEmail ?? '' }))
      await queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
  const title = m.credit_note_number({ number: note.number })

  return (
    <div className="grid gap-6 md:gap-7">
      <DetailHeader
        className="print:hidden"
        back={{
          label: m.invoice_number({ number: note.invoice.number }),
          to: '/invoices/$invoiceId',
          params: { invoiceId: note.invoice.id },
        }}
        crumb={title}
        title={title}
        meta={`${note.issueDate} · ${note.recipientName}`}
        actions={
          <>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => window.print()}
            >
              <Printer aria-hidden="true" />
              {m.invoice_print()}
            </Button>
            {canManage && note.recipientEmail && (
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={email.isPending}
                onClick={() => email.mutate({ data: { creditNoteId: note.id } })}
              >
                <Send aria-hidden="true" />
                {note.sentAt ? m.invoice_resend() : m.invoice_send_email()}
              </Button>
            )}
          </>
        }
      />

      <DetailColumns
        sideFirst
        main={
          <div className="rounded-xl bg-muted/50 p-2 sm:p-6 print:bg-transparent print:p-0">
            <PrintableCreditNote note={note} />
          </div>
        }
        side={
          <div className="grid gap-4 print:hidden">
            {notice && !email.error && (
              <p className="flex items-center gap-2 text-[13px] text-emerald-700 dark:text-emerald-300">
                <Check aria-hidden="true" className="size-4" />
                {notice}
              </p>
            )}
            {email.error && <p className="text-destructive text-sm">{email.error.message}</p>}
            <section
              aria-label={m.common_amount()}
              className="grid gap-0.5 rounded-xl border bg-card p-4 md:p-5"
            >
              <span className="font-medium text-[13px] text-muted-foreground">
                {m.credit_preview_credited()}
              </span>
              <span className="font-bold text-3xl tabular-nums tracking-tight">
                {formatSekShort(-note.totalOre)}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {note.refund ? m.credit_note_refund_hint() : m.credit_note_reduce_hint()}
              </span>
            </section>
            {note.refund && <RefundPanel note={note} canRefund={canRefund} />}
            <Panel title={m.credit_note_details()}>
              <FactList
                facts={[
                  [
                    m.credit_note_for_invoice(),
                    <Link
                      key="invoice"
                      to="/invoices/$invoiceId"
                      params={{ invoiceId: note.invoice.id }}
                      className="underline-offset-4 hover:underline"
                    >
                      {m.invoice_number({ number: note.invoice.number })}
                    </Link>,
                  ],
                  [m.credit_note_date(), note.issueDate],
                  [m.credit_form_reason(), note.reason],
                  [
                    m.credit_note_sent(),
                    note.sentAt ? stockholmDate(note.sentAt.getTime()) : m.credit_note_not_sent(),
                  ],
                ]}
              />
            </Panel>
          </div>
        }
      />
    </div>
  )
}

/** Whether the credited amount has been paid back to the tenant, and recording that it has. */
function RefundPanel({ note, canRefund }: { note: CreditNoteView; canRefund: boolean }) {
  const queryClient = useQueryClient()
  const today = stockholmDate(Date.now())
  const [refundedOn, setRefundedOn] = useState(today)
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['invoices'] })
  const refund = useMutation({ mutationFn: refundCreditNoteFn, onSuccess })
  const undo = useMutation({ mutationFn: undoCreditNoteRefundFn, onSuccess })
  const error = refund.error ?? undo.error

  return (
    <Panel title={m.credit_note_refund()}>
      <div className="grid gap-3 text-[13px]">
        {note.refundedOn ? (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
              <Banknote aria-hidden="true" className="size-4" />
              {m.credit_note_refunded_on({ date: note.refundedOn })}
            </span>
            {canRefund && (
              <Button
                variant="ghost"
                className="h-11 sm:h-8"
                disabled={undo.isPending}
                onClick={() => undo.mutate({ data: { creditNoteId: note.id } })}
              >
                <Undo2 aria-hidden="true" />
                {m.credit_note_undo_refund()}
              </Button>
            )}
          </div>
        ) : (
          <>
            <span className="font-medium text-amber-700 dark:text-amber-300">
              {m.credit_note_refund_due()}
            </span>
            {canRefund && (
              <div className="grid gap-2">
                <Label htmlFor="refundedOn">{m.credit_note_refund_date()}</Label>
                <Input
                  id="refundedOn"
                  type="date"
                  value={refundedOn}
                  min={note.issueDate}
                  max={today}
                  className="h-11 sm:h-9"
                  onChange={(e) => setRefundedOn(e.target.value)}
                />
                <Button
                  className="h-11 w-full sm:h-10"
                  disabled={refund.isPending}
                  onClick={() => refund.mutate({ data: { creditNoteId: note.id, refundedOn } })}
                >
                  {m.credit_note_register_refund()}
                </Button>
              </div>
            )}
          </>
        )}
        {error && <p className="text-destructive text-sm">{error.message}</p>}
      </div>
    </Panel>
  )
}

/** The credit note as printed or saved as PDF. Like the printed invoice, a Swedish document. */
function PrintableCreditNote({ note }: { note: CreditNoteView }) {
  const { seller, invoice } = note
  const hasVat = note.vatOre > 0
  const negative = (ore: number) => formatSek(-ore)

  return (
    <article className="mx-auto grid w-full max-w-3xl gap-6 rounded-lg border bg-card p-4 shadow-sm sm:gap-8 sm:p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap justify-between gap-6">
        <div>
          <p className="font-semibold text-lg">{seller.organizationName}</p>
          <p className="text-muted-foreground text-sm">
            {seller.streetAddress}
            {seller.streetAddress && <br />}
            {[seller.postalCode, seller.city].filter(Boolean).join(' ')}
          </p>
        </div>
        <div className="sm:text-right print:text-right">
          <h1 className="font-semibold text-2xl">Kreditfaktura</h1>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-4 text-sm sm:justify-end print:justify-end">
            <dt className="text-muted-foreground">Kreditfakturanummer</dt>
            <dd className="tabular-nums">{note.number}</dd>
            <dt className="text-muted-foreground">Datum</dt>
            <dd className="tabular-nums">{note.issueDate}</dd>
            <dt className="text-muted-foreground">Avser faktura</dt>
            <dd className="tabular-nums">
              {invoice.number} ({invoice.issueDate})
            </dd>
          </dl>
        </div>
      </header>

      <section className="text-sm">
        <p className="font-medium">{note.recipientName}</p>
        <p>{note.recipientStreetAddress}</p>
        <p>{[note.recipientPostalCode, note.recipientCity].filter(Boolean).join(' ')}</p>
      </section>

      <p className="text-sm">
        Kreditering av faktura {invoice.number} avseende hyra för{' '}
        {periodLabel({ start: invoice.periodStart, end: invoice.periodEnd })}. Orsak: {note.reason}
      </p>

      <table className="w-full text-left text-sm">
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="py-2 font-medium">Beskrivning</th>
            {hasVat && <th className="py-2 text-right font-medium">Moms</th>}
            <th className="py-2 text-right font-medium">Belopp</th>
          </tr>
        </thead>
        <tbody>
          {note.lines.map((line) => (
            <tr key={line.id} className="border-b">
              <td className="py-2">{line.description}</td>
              {hasVat && <td className="py-2 text-right">{line.vatRatePercent} %</td>}
              <td className="py-2 text-right tabular-nums">{negative(line.netOre)}</td>
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
                <td className="pt-2 text-right tabular-nums">{negative(note.netOre)}</td>
              </tr>
              <tr>
                <td colSpan={2}>Moms</td>
                <td className="text-right tabular-nums">{negative(note.vatOre)}</td>
              </tr>
            </>
          )}
          <tr className="font-semibold">
            <td className="pt-2" colSpan={hasVat ? 2 : 1}>
              Att kreditera
            </td>
            <td className="pt-2 text-right tabular-nums">{negative(note.totalOre)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-sm">
        {note.refund
          ? 'Fakturan är betald. Det krediterade beloppet betalas tillbaka.'
          : 'Det krediterade beloppet dras av från det som ska betalas på fakturan.'}
      </p>

      <footer className="grid gap-0.5 text-muted-foreground text-xs">
        {sellerDetails(seller, hasVat).map((line) => (
          <span key={line}>{line}</span>
        ))}
      </footer>
    </article>
  )
}
