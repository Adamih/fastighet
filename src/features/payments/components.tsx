import { cn } from '#/lib/utils'
import { type PaymentStatus, paymentStatusLabels } from './matching'

const styles: Record<PaymentStatus, string> = {
  matched: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  review: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  unmatched: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  ignored: 'bg-muted text-muted-foreground',
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={cn('inline-flex rounded-full px-2 py-0.5 font-medium text-xs', styles[status])}
    >
      {paymentStatusLabels[status]}
    </span>
  )
}
