import { cn } from '#/lib/utils'
import { type InvoiceStatus, invoiceStatusLabels } from './rules'

const statusStyles: Record<InvoiceStatus, string> = {
  unpaid: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  void: 'bg-muted text-muted-foreground line-through',
}

const dotStyles: Record<InvoiceStatus, string> = {
  unpaid: 'bg-sky-600 dark:bg-sky-400',
  overdue: 'bg-red-600 dark:bg-red-400',
  paid: 'bg-emerald-600 dark:bg-emerald-400',
  void: 'bg-muted-foreground',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-semibold text-xs',
        statusStyles[status],
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', dotStyles[status])} />
      {invoiceStatusLabels[status]}
    </span>
  )
}
