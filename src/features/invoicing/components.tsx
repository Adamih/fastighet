import { cn } from '#/lib/utils'
import { type InvoiceStatus, invoiceStatusLabels } from './rules'

const statusStyles: Record<InvoiceStatus, string> = {
  unpaid: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  void: 'bg-muted text-muted-foreground line-through',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 font-medium text-xs',
        statusStyles[status],
      )}
    >
      {invoiceStatusLabels[status]}
    </span>
  )
}
