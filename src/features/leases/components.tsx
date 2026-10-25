import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { leaseStatusLabels } from './options'
import type { LeaseStatus } from './terms'

const statusStyles: Record<LeaseStatus, string> = {
  upcoming: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  terminated: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  ended: 'bg-muted text-muted-foreground',
}

const dotStyles: Record<LeaseStatus, string> = {
  upcoming: 'bg-sky-600 dark:bg-sky-400',
  active: 'bg-emerald-600 dark:bg-emerald-400',
  terminated: 'bg-amber-600 dark:bg-amber-400',
  ended: 'bg-muted-foreground',
}

export function LeaseStatusBadge({ status }: { status: LeaseStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-semibold text-xs',
        statusStyles[status],
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', dotStyles[status])} />
      {leaseStatusLabels[status]}
    </span>
  )
}

export function formatPeriod(lease: {
  startDate: string
  termEndDate: string | null
  extensionMonths: number | null
  moveOutDate: string | null
}) {
  if (lease.moveOutDate) return `${lease.startDate} – ${lease.moveOutDate}`
  if (!lease.termEndDate) return m.lease_period_open_dash({ start: lease.startDate })
  if (lease.extensionMonths) {
    return m.lease_period_renewing({
      start: lease.startDate,
      end: lease.termEndDate,
      months: lease.extensionMonths,
    })
  }
  return `${lease.startDate} – ${lease.termEndDate}`
}
