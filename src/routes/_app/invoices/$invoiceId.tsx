import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertCircle,
  Ban,
  Banknote,
  BellRing,
  Check,
  CircleCheck,
  Copy,
  FilePen,
  FilePlus,
  type LucideIcon,
  Mail,
  Printer,
  ReceiptText,
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
  MoreActions,
  Panel,
  PanelRow,
} from '#/components/detail'
import { Button } from '#/components/ui/button'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { AgreementLink, agreementNumberLabel } from '#/features/agreements/components'
import { useCan } from '#/features/auth/use-can'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { inForce, voidProblem } from '#/features/invoicing/correction'
import { remainingOre } from '#/features/invoicing/credit'
import { useCreditInvoiceDrawer } from '#/features/invoicing/credit-note-form'
import {
  type InvoiceEvent,
  type InvoiceEventKind,
  invoiceEvents,
} from '#/features/invoicing/detail'
import {
  emailInvoiceFn,
  invoiceQuery,
  markInvoicePaidFn,
  unmarkInvoicePaidFn,
  voidInvoiceFn,
} from '#/features/invoicing/functions'
import type { InvoiceView } from '#/features/invoicing/program'
import { RefundPanel } from '#/features/invoicing/refund-panel'
import { useReissueInvoiceDrawer } from '#/features/invoicing/reissue-form'
import { periodLabel, vatNumberFor } from '#/features/invoicing/rules'
import { daysUntil, inDays } from '#/features/leases/overview'
import { PaymentStatusBadge } from '#/features/payments/components'
import { sendReminderFn } from '#/features/reminders/functions'
import { documentTerms } from '#/features/settings/terminology'
import { stockholmDate } from '#/lib/dates'
import { formatSek, formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/invoices/$invoiceId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(invoiceQuery(params.invoiceId)),
  component: InvoicePage,
})

function InvoicePage() {
  const { invoiceId } = Route.useParams()
  const { data: invoice } = useSuspenseQuery(invoiceQuery(invoiceId))
  const can = useCan()
  const canManage = can({ invoice: ['manage'] })
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const today = stockholmDate(Date.now())
  const credit = useCreditInvoiceDrawer(invoice)
  const canCredit = invoice.status !== 'void' && remainingOre(invoice) > 0
  const reissue = useReissueInvoiceDrawer(invoice)
  // A voided or fully credited avi can be replaced, once; a replacement is corrected from itself.
  const canReissue =
    can({ lease: ['read'] }) && !inForce(invoice) && invoice.replacedBy.length === 0

  const onDone = async () => {
    await queryClient.invalidateQueries({ queryKey: ['invoices'] })
    await queryClient.invalidateQueries({ queryKey: ['payments'] })
  }
  const email = useMutation({
    mutationFn: emailInvoiceFn,
    onSuccess: async () => {
      setNotice(m.invoice_sent_to({ email: invoice.recipientEmail ?? '' }))
      await onDone()
    },
  })
  const remind = useMutation({
    mutationFn: sendReminderFn,
    onSuccess: async () => {
      setNotice(m.invoice_reminder_sent({ email: invoice.recipientEmail ?? '' }))
      await onDone()
    },
  })
  const unpay = useMutation({ mutationFn: unmarkInvoicePaidFn, onSuccess: onDone })
  const voidIt = useMutation({
    mutationFn: voidInvoiceFn,
    onSuccess: async () => {
      setConfirmVoid(false)
      await onDone()
    },
  })
  const error = email.error ?? remind.error ?? unpay.error ?? voidIt.error
  const data = { invoiceId: invoice.id }
  const open = invoice.status === 'unpaid' || invoice.status === 'overdue'
  const period = periodLabel({ start: invoice.periodStart, end: invoice.periodEnd })

  return (
    <div className="grid gap-6 md:gap-7">
      <DetailHeader
        className="print:hidden"
        back={{ label: m.nav_invoices(), to: '/invoices' }}
        crumb={m.invoice_number({ number: invoice.number })}
        title={m.invoice_number({ number: invoice.number })}
        badge={<InvoiceStatusBadge status={invoice.status} />}
        meta={
          <>
            {period} · {invoice.recipientName} ·{' '}
            {can({ lease: ['read'] }) ? (
              <AgreementLink
                agreement={invoice.agreement}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {agreementNumberLabel(invoice.agreement.kind, invoice.agreement.number)}
              </AgreementLink>
            ) : (
              agreementNumberLabel(invoice.agreement.kind, invoice.agreement.number)
            )}
          </>
        }
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
            {canManage && invoice.status !== 'void' && invoice.recipientEmail && (
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={email.isPending}
                onClick={() => email.mutate({ data })}
              >
                <Send aria-hidden="true" />
                {invoice.sentAt ? m.invoice_resend() : m.invoice_send_email()}
              </Button>
            )}
            {canManage && (open || invoice.paidOre > 0 || canCredit || canReissue) && (
              <MoreActions label={m.invoice_more_actions({ number: invoice.number })}>
                {invoice.status === 'overdue' && invoice.recipientEmail && (
                  <DropdownMenuItem
                    disabled={remind.isPending}
                    onSelect={() => remind.mutate({ data: { invoiceId: invoice.id } })}
                  >
                    <BellRing aria-hidden="true" />
                    {m.invoice_send_reminder()}
                  </DropdownMenuItem>
                )}
                {canReissue && (
                  <DropdownMenuItem onSelect={reissue.open}>
                    <FilePen aria-hidden="true" />
                    {m.invoice_reissue()}
                  </DropdownMenuItem>
                )}
                {canCredit && (
                  <DropdownMenuItem onSelect={credit.open}>
                    <ReceiptText aria-hidden="true" />
                    {m.invoice_credit()}
                  </DropdownMenuItem>
                )}
                {invoice.paidOre > 0 && (
                  <DropdownMenuItem
                    disabled={unpay.isPending}
                    onSelect={() => unpay.mutate({ data })}
                  >
                    <Undo2 aria-hidden="true" />
                    {m.invoice_undo_payment()}
                  </DropdownMenuItem>
                )}
                {voidProblem(invoice) === null ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmVoid(true)}>
                    <Ban aria-hidden="true" />
                    {m.invoice_void()}
                  </DropdownMenuItem>
                ) : (
                  // A sent avi is corrected with a credit note; say so where voiding used to be.
                  voidProblem(invoice) === 'sent' && (
                    <DropdownMenuItem disabled className="items-start">
                      <Ban aria-hidden="true" className="mt-0.5" />
                      <span className="grid gap-0.5">
                        {m.invoice_void()}
                        <span className="text-xs">{m.invoice_void_sent_hint()}</span>
                      </span>
                    </DropdownMenuItem>
                  )
                )}
              </MoreActions>
            )}
          </>
        }
      />

      <DetailColumns
        sideFirst
        main={
          <div className="rounded-xl bg-muted/50 p-2 sm:p-6 print:bg-transparent print:p-0">
            <PrintableInvoice invoice={invoice} />
          </div>
        }
        side={
          <div className="grid gap-4 print:hidden">
            {confirmVoid && (
              <section className="grid gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <p>{m.invoice_void_confirm({ number: invoice.number })}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="h-11 flex-1 sm:h-9"
                    onClick={() => setConfirmVoid(false)}
                  >
                    {m.common_cancel()}
                  </Button>
                  <Button
                    variant="destructive"
                    className="h-11 flex-1 sm:h-9"
                    disabled={voidIt.isPending}
                    onClick={() => voidIt.mutate({ data })}
                  >
                    {m.invoice_void_confirm_action()}
                  </Button>
                </div>
              </section>
            )}
            {notice && !error && (
              <p className="flex items-center gap-2 text-[13px] text-emerald-700 dark:text-emerald-300">
                <Check aria-hidden="true" className="size-4" />
                {notice}
              </p>
            )}
            {error && <p className="text-destructive text-sm">{error.message}</p>}
            <AmountPanel invoice={invoice} today={today} canManage={canManage} onDone={onDone} />
            {(invoice.refundDueOre > 0 || invoice.refundedOre > 0) && (
              <RefundPanel
                invoice={invoice}
                canRefund={can({ invoice: ['manage'], payment: ['manage'] })}
              />
            )}
            {(invoice.replaces || invoice.replacedBy.length > 0) && (
              <nav aria-label={m.invoice_reissue()} className="grid gap-1.5 text-[13px]">
                {invoice.replaces && (
                  <ReplacementLink
                    invoiceId={invoice.replaces.id}
                    text={m.invoice_replaces({ number: invoice.replaces.number })}
                  />
                )}
                {invoice.replacedBy.map((r) => (
                  <ReplacementLink
                    key={r.id}
                    invoiceId={r.id}
                    text={m.invoice_replaced_by({ number: r.number })}
                  />
                ))}
              </nav>
            )}
            <Panel title={m.detail_events()}>
              <EventList
                events={invoiceEvents(
                  {
                    status: invoice.status,
                    createdOn: invoice.issueDate,
                    sentOn: invoice.sentAt ? stockholmDate(invoice.sentAt.getTime()) : null,
                    dueDate: invoice.dueDate,
                    paidOn: invoice.paidOn,
                    voidedOn: invoice.voidedAt ? stockholmDate(invoice.voidedAt.getTime()) : null,
                    creditNotes: invoice.creditNotes,
                    refunds: invoice.refunds,
                    reminders: invoice.reminders,
                    replacedBy: invoice.replacedBy,
                  },
                  today,
                ).map((e) => eventView(e, invoice.recipientEmail))}
              />
            </Panel>
            {invoice.reminders.length > 0 && (
              <Panel title={m.invoice_reminders()}>
                <div>
                  {invoice.reminders.map((r) => (
                    <PanelRow key={r.id}>
                      <span className="grid min-w-0 gap-0.5">
                        <span className="font-semibold">
                          {m.invoice_reminder_title({ sequence: r.sequence })}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {m.invoice_reminder_meta({ date: r.sentOn, due: r.dueDate })}
                        </span>
                      </span>
                      <span className="grid shrink-0 justify-items-end gap-0.5">
                        <span className="font-semibold tabular-nums">
                          {formatSekShort(r.owedOre)}
                        </span>
                        {r.feeOre > 0 && (
                          <span className="text-muted-foreground text-xs">
                            {m.invoice_reminder_fee({ fee: formatSekShort(r.feeOre) })}
                          </span>
                        )}
                      </span>
                    </PanelRow>
                  ))}
                </div>
              </Panel>
            )}
            {invoice.creditNotes.length > 0 && (
              <Panel title={m.invoice_credit_notes()}>
                <div>
                  {invoice.creditNotes.map((note) => (
                    <PanelRow key={note.id}>
                      <span className="grid min-w-0 gap-0.5">
                        <Link
                          to="/credit-notes/$creditNoteId"
                          params={{ creditNoteId: note.id }}
                          className="font-semibold underline-offset-4 hover:underline"
                        >
                          {m.credit_note_number({ number: note.number })}
                        </Link>
                        <span className="truncate text-muted-foreground">
                          {note.issueDate} · {note.reason}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatSekShort(-note.totalOre)}
                      </span>
                    </PanelRow>
                  ))}
                </div>
              </Panel>
            )}
            {can({ payment: ['read'] }) && (
              <Panel
                title={m.invoice_payments()}
                action={
                  <Link
                    to="/payments"
                    search={{ filter: 'all' }}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {m.invoice_all_payments()}
                  </Link>
                }
              >
                {invoice.payments.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">{m.invoice_payments_empty()}</p>
                ) : (
                  <div>
                    {invoice.payments.map((p) => (
                      <PanelRow key={p.id}>
                        <span className="grid min-w-0 gap-0.5">
                          <span className="font-semibold tabular-nums">
                            {formatSekShort(p.amountOre)}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {p.date} · {p.payerName ?? m.invoice_paid_by_hand()}
                          </span>
                        </span>
                        {p.status && <PaymentStatusBadge status={p.status} />}
                      </PanelRow>
                    ))}
                  </div>
                )}
              </Panel>
            )}
          </div>
        }
      />
    </div>
  )
}

const eventIcons: Record<InvoiceEventKind, [LucideIcon, EventTone]> = {
  created: [FilePlus, 'neutral'],
  sent: [Mail, 'neutral'],
  fellDue: [AlertCircle, 'bad'],
  paid: [CircleCheck, 'good'],
  voided: [Ban, 'neutral'],
  credited: [ReceiptText, 'neutral'],
  refunded: [Banknote, 'neutral'],
  reminded: [BellRing, 'warn'],
  replaced: [FilePen, 'neutral'],
}

function eventView(e: InvoiceEvent, email: string | null): DetailEvent {
  const [icon, tone] = eventIcons[e.kind]
  const text = {
    created: m.invoice_event_created(),
    sent: email ? m.invoice_sent_to({ email }) : m.invoice_sent(),
    fellDue: m.invoice_event_fell_due(),
    paid: m.invoice_status_paid(),
    voided: m.invoice_status_void(),
    credited: m.invoice_event_credited({
      amount: formatSekShort(e.creditNote?.totalOre ?? 0),
      number: e.creditNote?.number ?? 0,
    }),
    refunded: m.invoice_event_refunded({ amount: formatSekShort(e.amountOre ?? 0) }),
    reminded: e.amountOre
      ? m.invoice_event_reminded_fee({
          sequence: e.sequence ?? 0,
          fee: formatSekShort(e.amountOre),
        })
      : m.invoice_event_reminded({ sequence: e.sequence ?? 0 }),
    replaced: m.invoice_event_replaced({ number: e.invoiceNumber ?? 0 }),
  }[e.kind]
  const id =
    e.creditNote?.number ??
    e.invoiceNumber ??
    e.sequence ??
    (e.kind === 'refunded' ? e.date : undefined)
  const key = id === undefined ? e.kind : `${e.kind}-${id}`
  return { key, icon, tone, text, date: e.date }
}

function ReplacementLink({ invoiceId, text }: { invoiceId: string; text: string }) {
  return (
    <Link
      to="/invoices/$invoiceId"
      params={{ invoiceId }}
      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 font-medium underline-offset-4 hover:underline"
    >
      <FilePen aria-hidden="true" className="size-4 text-muted-foreground" />
      {text}
    </Link>
  )
}

/** What is owed and how to settle it. */
function AmountPanel({
  invoice,
  today,
  canManage,
  onDone,
}: {
  invoice: InvoiceView
  today: string
  canManage: boolean
  onDone: () => Promise<void>
}) {
  const [paidOn, setPaidOn] = useState(today)
  const [copied, setCopied] = useState(false)
  const pay = useMutation({ mutationFn: markInvoicePaidFn, onSuccess: onDone })
  const open = invoice.status === 'unpaid' || invoice.status === 'overdue'
  const days = daysUntil(today, invoice.dueDate)
  const status = {
    overdue: m.invoice_overdue_since({ days: -days }),
    unpaid: days === 0 ? m.invoice_due_today() : m.invoice_due_relative({ when: inDays(days) }),
    paid: m.invoice_paid_on({ date: invoice.paidOn ?? '' }),
    void: m.invoice_void_no_payment(),
    credited: m.invoice_fully_credited(),
  }[invoice.status]

  return (
    <section
      aria-label={m.common_amount()}
      className={cn(
        'grid gap-3 rounded-xl border bg-card p-4 md:p-5',
        invoice.status === 'overdue' && 'border-destructive/40',
      )}
    >
      <div className="grid gap-0.5">
        <span
          className={cn(
            'font-medium text-[13px]',
            invoice.status === 'overdue'
              ? 'text-destructive'
              : invoice.status === 'paid'
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-muted-foreground',
          )}
        >
          {status}
        </span>
        <span
          className={cn(
            'font-bold text-3xl tabular-nums tracking-tight',
            invoice.status === 'void' && 'text-muted-foreground line-through',
          )}
        >
          {formatSekShort(open ? invoice.owedOre : invoice.totalOre)}
        </span>
        {open && invoice.paidOre > 0 && (
          <span className="text-[13px] text-muted-foreground">
            {m.invoice_partly_paid({
              paid: formatSekShort(invoice.paidOre),
              total: formatSekShort(invoice.totalOre - invoice.creditedOre),
            })}
          </span>
        )}
        {invoice.creditedOre > 0 && (
          <span
            className={cn(
              'text-[13px] text-muted-foreground',
              invoice.refundDueOre > 0 && 'font-medium text-amber-700 dark:text-amber-300',
            )}
          >
            {invoice.refundDueOre > 0
              ? m.invoice_refund_due({ amount: formatSekShort(invoice.refundDueOre) })
              : invoice.refundedOre > 0
                ? m.invoice_refunded({ amount: formatSekShort(invoice.refundedOre) })
                : m.invoice_amount_after_credit({
                    total: formatSekShort(invoice.totalOre),
                    credited: formatSekShort(invoice.creditedOre),
                  })}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {open ? m.invoice_amount_ocr_to_pay() : m.invoice_amount_ocr()}{' '}
          <span className="font-medium text-foreground tabular-nums">{invoice.ocr}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={copied ? m.invoice_ocr_copied() : m.invoice_copy_ocr()}
            onClick={async () => {
              await navigator.clipboard.writeText(invoice.ocr)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </Button>
        </span>
      </div>
      {canManage && open && (
        <div className="grid gap-2 border-t pt-3">
          <Label htmlFor="paidOn">{m.invoice_paid_on_label()}</Label>
          <Input
            id="paidOn"
            type="date"
            value={paidOn}
            className="h-11 sm:h-9"
            onChange={(e) => setPaidOn(e.target.value)}
          />
          <Button
            className="h-11 w-full sm:h-10"
            disabled={pay.isPending}
            onClick={() => pay.mutate({ data: { invoiceId: invoice.id, paidOn } })}
          >
            {m.invoice_register_payment()}
          </Button>
          {pay.error && <p className="text-destructive text-sm">{pay.error.message}</p>}
        </div>
      )}
    </section>
  )
}

/** The invoice as printed or saved as PDF from the browser. */
function PrintableInvoice({ invoice }: { invoice: InvoiceView }) {
  const { seller } = invoice
  const hasVat = invoice.vatOre > 0
  const period = periodLabel({ start: invoice.periodStart, end: invoice.periodEnd })

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
          <h1 className="font-semibold text-2xl">
            {documentTerms(invoice.agreement.kind).invoiceTitle}
            {invoice.status === 'void' && ' (makulerad)'}
            {invoice.status === 'credited' && ' (krediterad)'}
          </h1>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-4 text-sm sm:justify-end print:justify-end">
            <dt className="text-muted-foreground">Fakturanummer</dt>
            <dd className="tabular-nums">{invoice.number}</dd>
            <dt className="text-muted-foreground">Fakturadatum</dt>
            <dd className="tabular-nums">{invoice.issueDate}</dd>
            <dt className="text-muted-foreground">Avtal</dt>
            <dd className="tabular-nums">{invoice.agreement.number}</dd>
            {invoice.replaces && (
              <>
                <dt className="text-muted-foreground">Ersätter faktura</dt>
                <dd className="tabular-nums">{invoice.replaces.number}</dd>
              </>
            )}
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

      <section className="grid gap-x-8 gap-y-1 rounded-md bg-muted p-4 text-sm grid-cols-2 sm:grid-cols-4">
        <PaymentField label="Bankgiro" value={seller.bankgiro ?? '–'} />
        <PaymentField label="OCR-nummer" value={invoice.ocr} />
        <PaymentField label="Förfallodag" value={invoice.dueDate} />
        <PaymentField label="Belopp" value={formatSek(invoice.totalOre)} />
      </section>

      <footer className="text-muted-foreground text-xs">
        {documentTerms(invoice.agreement.kind).charge} för {period}. Ange OCR-numret vid betalning.
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
