import { Link } from '@tanstack/react-router'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { periodLabel } from '#/features/invoicing/rules'
import { formatShortDate } from '#/features/leases/overview'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'
import type { PortalInvoice } from './invoices-program'

/** One avi in a list: number, period, due date, status and what is left to pay. */
export function PortalInvoiceRow({ invoice }: { invoice: PortalInvoice }) {
  const open = invoice.status === 'unpaid' || invoice.status === 'overdue'
  return (
    <Link
      to="/portal/avier/$invoiceId"
      params={{ invoiceId: invoice.id }}
      className="flex min-h-16 items-center justify-between gap-3 border-t px-1 py-3 first:border-t-0 hover:bg-accent/50"
    >
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate font-semibold">
          {invoice.title} {invoice.number}
        </span>
        <span className="truncate text-muted-foreground text-sm">
          {periodLabel({ start: invoice.periodStart, end: invoice.periodEnd })} ·{' '}
          {m.portal_invoice_due({ date: formatShortDate(invoice.dueDate) })}
        </span>
      </span>
      <span className="grid shrink-0 justify-items-end gap-1">
        <span className="font-semibold tabular-nums">
          {formatSek(open ? invoice.owedOre : invoice.totalOre)}
        </span>
        <InvoiceStatusBadge status={invoice.status} />
      </span>
    </Link>
  )
}

/** A value to copy into the bank's payment form (bankgiro, OCR, amount). */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center justify-between gap-3 border-t py-2.5 first:border-t-0">
      <span className="grid min-w-0">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="truncate font-semibold text-base tabular-nums">{value}</span>
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-11 shrink-0 sm:size-9"
        aria-label={m.portal_copy({ label })}
        onClick={async () => {
          await navigator.clipboard?.writeText(value.replace(/\s/g, ''))
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  )
}
