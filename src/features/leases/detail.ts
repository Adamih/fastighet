import { invoicePeriod, type Period } from '#/features/invoicing/rules'
import { addDays, addMonths, maxDate } from '#/lib/dates'
import type { LeaseTerms } from './terms'

// Pure rules for the lease page: the next invoice period and what has happened to the lease.

interface LeaseInvoice {
  readonly number: number
  readonly periodStart: string
  readonly periodEnd: string
  readonly status: 'void' | 'paid' | 'credited' | 'overdue' | 'unpaid'
  /** ISO date the invoice was emailed, if it was. */
  readonly sentOn: string | null
  readonly paidOn: string | null
}

/**
 * The period the next invoice run will cover: the one after the latest invoice (voided ones
 * don't count). Without invoices, the current period, or the one the lease starts in if that is
 * later. Null once the lease has been invoiced to its end.
 */
export function nextInvoicePeriod(
  lease: {
    startDate: string
    /** The last billed day. */
    endDate: string | null
    invoiceInterval: 'monthly' | 'quarterly'
  },
  invoices: readonly LeaseInvoice[],
  today: string,
): Period | null {
  const lastEnd = invoices
    .filter((i) => i.status !== 'void')
    .map((i) => i.periodEnd)
    .sort()
    .at(-1)
  let month = (lastEnd ? addDays(lastEnd, 1) : maxDate(lease.startDate, today)).slice(0, 7)
  // A quarterly lease mid-quarter belongs to the quarter that already started.
  if (!lastEnd && lease.invoiceInterval === 'quarterly') {
    const m = Number(month.slice(5, 7))
    const quarterStart = month.slice(0, 5) + String(m - ((m - 1) % 3)).padStart(2, '0')
    if (`${quarterStart}-01` >= `${lease.startDate.slice(0, 7)}-01`) month = quarterStart
  }
  // Quarterly leases are only invoiced in Jan/Apr/Jul/Oct; step forward to the next of those.
  for (let i = 0; i < 3; i++) {
    const period = invoicePeriod(month, lease.invoiceInterval)
    if (period) {
      const end = lease.endDate
      return end && period.start > end ? null : period
    }
    month = addMonths(`${month}-01`, 1).slice(0, 7)
  }
  return null
}

export type LeaseEventKind =
  | 'created'
  | 'started'
  | 'noticeGiven'
  | 'movedOut'
  | 'invoiceSent'
  | 'invoicePaid'

export interface LeaseEvent {
  readonly kind: LeaseEventKind
  /** ISO date. */
  readonly date: string
  readonly invoiceNumber?: number
}

/** What has happened so far, newest first. Built from stored dates; future dates are left out. */
export function leaseEvents(
  lease: LeaseTerms & { createdOn: string; noticeDate: string | null },
  invoices: readonly LeaseInvoice[],
  today: string,
): LeaseEvent[] {
  const events: LeaseEvent[] = [
    { kind: 'created', date: lease.createdOn },
    { kind: 'started', date: lease.startDate },
    ...(lease.noticeDate ? [{ kind: 'noticeGiven' as const, date: lease.noticeDate }] : []),
    ...(lease.moveOutDate ? [{ kind: 'movedOut' as const, date: lease.moveOutDate }] : []),
    ...invoices.flatMap((i) => [
      ...(i.sentOn
        ? [{ kind: 'invoiceSent' as const, date: i.sentOn, invoiceNumber: i.number }]
        : []),
      ...(i.paidOn
        ? [{ kind: 'invoicePaid' as const, date: i.paidOn, invoiceNumber: i.number }]
        : []),
    ]),
  ]
  return events
    .filter((e) => e.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || order[a.kind] - order[b.kind])
}

/** On the same day, later steps come first (the list is newest first). */
const order: Record<LeaseEventKind, number> = {
  movedOut: 0,
  invoicePaid: 1,
  invoiceSent: 2,
  noticeGiven: 3,
  started: 4,
  created: 5,
}

const shortMonth = new Intl.DateTimeFormat('sv-SE', { month: 'short', timeZone: 'UTC' })
const monthOf = (date: string) => shortMonth.format(new Date(`${date}T00:00:00Z`)).replace('.', '')

/** "nov 2026", or "okt–dec 2026" for a quarter. For tight spaces such as figure tiles. */
export function shortPeriodLabel(period: Period): string {
  const year = period.end.slice(0, 4)
  if (period.start.slice(0, 7) === period.end.slice(0, 7)) return `${monthOf(period.start)} ${year}`
  return `${monthOf(period.start)}–${monthOf(period.end)} ${year}`
}
