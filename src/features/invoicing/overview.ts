import { daysUntil, inDays } from '#/features/leases/overview'
import type { InvoiceStatus } from './rules'
import type { InvoiceFilter } from './schemas'

// Pure presentation rules for the invoice list: the summary figures, filter counts and the
// due-date note. Shared by the desktop table and the phone cards.

interface OverviewInvoice {
  readonly status: InvoiceStatus
  readonly totalOre: number
  readonly dueDate: string
}

const isOpen = (status: InvoiceStatus) => status === 'unpaid' || status === 'overdue'

const sum = (invoices: readonly OverviewInvoice[]) => ({
  count: invoices.length,
  totalOre: invoices.reduce((total, i) => total + i.totalOre, 0),
})

/** "Obetalda" includes overdue invoices: both are still waiting for payment. */
export const matchesFilter = (status: InvoiceStatus, filter: InvoiceFilter) =>
  filter === 'all' || status === filter || (filter === 'unpaid' && status === 'overdue')

/** "1 avi", "3 avier" */
export const invoiceCount = (count: number) => `${count} ${count === 1 ? 'avi' : 'avier'}`

/** "i dag", "i går", "23 dagar sen" */
export function daysAgo(days: number): string {
  if (days === 0) return 'i dag'
  if (days === 1) return 'i går'
  return `${days} dagar sen`
}

/** How the due date relates to today, for open invoices: "om 5 dagar", "23 dagar sen". */
export function dueNote(invoice: OverviewInvoice, today: string): string | null {
  if (!isOpen(invoice.status)) return null
  const days = daysUntil(today, invoice.dueDate)
  return days < 0 ? daysAgo(-days) : inDays(days)
}

export function invoiceOverview(invoices: readonly OverviewInvoice[], today: string) {
  const open = invoices.filter((i) => isOpen(i.status))
  const overdue = invoices.filter((i) => i.status === 'overdue')
  const paid = invoices.filter((i) => i.status === 'paid')
  const oldestDue = overdue.map((i) => i.dueDate).sort()[0]
  const counts: Record<InvoiceFilter, number> = {
    all: invoices.length,
    unpaid: open.length,
    overdue: overdue.length,
    paid: paid.length,
    void: invoices.filter((i) => i.status === 'void').length,
  }
  return {
    counts,
    outstanding: sum(open),
    overdue: {
      ...sum(overdue),
      /** Days since the oldest overdue invoice fell due. */
      oldestDays: oldestDue ? -daysUntil(today, oldestDue) : null,
    },
    paid: sum(paid),
  }
}
