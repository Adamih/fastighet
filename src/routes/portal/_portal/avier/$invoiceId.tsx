import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { periodLabel } from '#/features/invoicing/rules'
import { formatShortDate } from '#/features/leases/overview'
import { CopyValue } from '#/features/portal/components'
import { portalInvoiceQuery } from '#/features/portal/portal-functions'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/portal/_portal/avier/$invoiceId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(portalInvoiceQuery(params.invoiceId)),
  component: PortalInvoicePage,
})

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  )
}

function PortalInvoicePage() {
  const { invoiceId } = Route.useParams()
  const { data: avi } = useSuspenseQuery(portalInvoiceQuery(invoiceId))
  const open = avi.status === 'unpaid' || avi.status === 'overdue'

  return (
    <div className="grid gap-4">
      <Link
        to="/portal/avier"
        className="inline-flex h-11 items-center gap-1 text-muted-foreground text-sm sm:h-auto"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {m.portal_nav_invoices()}
      </Link>
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-bold text-2xl tracking-tight">
            {avi.title} {avi.number}
          </h1>
          <InvoiceStatusBadge status={avi.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {periodLabel({ start: avi.periodStart, end: avi.periodEnd })} ·{' '}
          {m.portal_invoice_due({ date: formatShortDate(avi.dueDate) })}
        </p>
      </header>

      {open && (
        <Section title={m.portal_pay_title()}>
          {avi.pay.bankgiro ? (
            <div>
              <CopyValue label={m.portal_pay_amount()} value={formatSek(avi.owedOre)} />
              <CopyValue label={m.portal_pay_bankgiro()} value={avi.pay.bankgiro} />
              <CopyValue label={m.portal_pay_ocr()} value={avi.pay.ocr} />
              <p className="pt-2 text-muted-foreground text-xs">
                {m.portal_pay_hint({ date: formatShortDate(avi.dueDate) })}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{m.portal_pay_no_bankgiro()}</p>
          )}
        </Section>
      )}

      <Section title={m.portal_invoice_lines()}>
        {avi.lines.map((line) => (
          <Row key={line.position} label={line.description} value={formatSek(line.netOre)} />
        ))}
        <div className="grid gap-1 border-t pt-2">
          {avi.vatOre > 0 && <Row label={m.portal_invoice_vat()} value={formatSek(avi.vatOre)} />}
          <Row label={m.portal_invoice_total()} value={formatSek(avi.totalOre)} strong />
          {avi.creditUsedOre > 0 && (
            <Row label={m.portal_invoice_credit_used()} value={formatSek(-avi.creditUsedOre)} />
          )}
          {avi.creditedOre > 0 && (
            <Row label={m.portal_invoice_credited()} value={formatSek(-avi.creditedOre)} />
          )}
          {avi.paidOre > 0 && (
            <Row label={m.portal_invoice_paid()} value={formatSek(-avi.paidOre)} />
          )}
          <Row label={m.portal_invoice_left()} value={formatSek(avi.owedOre)} strong />
        </div>
      </Section>

      {avi.payments.length > 0 && (
        <Section title={m.portal_invoice_payments()}>
          {avi.payments.map((p) => (
            <Row
              key={p.id}
              label={`${formatShortDate(p.date)} · ${
                p.kind === 'credit_use' ? m.portal_payment_credit() : m.portal_payment_paid()
              }`}
              value={formatSek(p.amountOre)}
            />
          ))}
        </Section>
      )}

      {(avi.reminders.length > 0 || avi.lateInterest) && (
        <Section title={m.portal_invoice_reminders()}>
          {avi.reminders.map((r) => (
            <Row
              key={r.sequence}
              label={m.portal_reminder_line({
                sequence: r.sequence,
                date: formatShortDate(r.sentOn),
              })}
              value={
                r.feeOre > 0 && !r.feeWaivedOn
                  ? m.portal_reminder_fee({ amount: formatSek(r.feeOre) })
                  : ''
              }
            />
          ))}
          {avi.lateInterest && (
            <Row
              label={m.portal_late_interest({ days: avi.lateInterest.days })}
              value={formatSek(avi.lateInterest.amountOre)}
            />
          )}
          <p className="text-muted-foreground text-xs">{m.portal_fees_next_avi()}</p>
        </Section>
      )}

      {avi.creditNotes.length > 0 && (
        <Section title={m.portal_invoice_credit_notes()}>
          {avi.creditNotes.map((c) => (
            <Row
              key={c.number}
              label={m.portal_credit_note_line({
                number: c.number,
                date: formatShortDate(c.issueDate),
              })}
              value={formatSek(-c.totalOre)}
            />
          ))}
        </Section>
      )}

      <Section title={m.portal_payment_method()}>
        <p className="text-muted-foreground text-sm">{m.portal_payment_method_bankgiro()}</p>
      </Section>
    </div>
  )
}
