import { formatSek } from '#/lib/money'
import { cn } from '#/lib/utils'
import { leaseStatusLabels, type RentInterval, rentIntervalLabels } from './options'
import type { LeaseStatus } from './terms'

const statusStyles: Record<LeaseStatus, string> = {
  upcoming: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  terminated: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  ended: 'bg-muted text-muted-foreground',
}

export function LeaseStatusBadge({ status }: { status: LeaseStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 font-medium text-xs',
        statusStyles[status],
      )}
    >
      {leaseStatusLabels[status]}
    </span>
  )
}

export function formatRent(lease: { rentOre: number; rentInterval: RentInterval; vat: boolean }) {
  return `${formatSek(lease.rentOre)} ${rentIntervalLabels[lease.rentInterval]}${lease.vat ? ' + moms' : ''}`
}

export function formatPeriod(lease: {
  startDate: string
  endDate: string | null
  extensionMonths: number | null
  moveOutDate: string | null
}) {
  if (lease.moveOutDate) return `${lease.startDate} – ${lease.moveOutDate}`
  if (!lease.endDate) return `${lease.startDate} – tillsvidare`
  const extension = lease.extensionMonths ? ` (förlängs ${lease.extensionMonths} mån)` : ''
  return `${lease.startDate} – ${lease.endDate}${extension}`
}
