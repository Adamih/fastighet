// Pure rules for what follows a correction: paying credited amounts back on paid invoices, and
// corrected avier that replace a voided or fully credited one. Shared by the server and the UI.

interface InvoiceAmounts {
  readonly voidedAt: Date | null
  readonly totalOre: number
  readonly creditedOre: number
}

/**
 * Whether the avi still counts for its period. Voided and fully credited avier don't, so a
 * corrected avi may replace them (the database's unique index on lease and period agrees).
 */
export const inForce = (invoice: InvoiceAmounts) =>
  invoice.voidedAt === null && invoice.creditedOre < invoice.totalOre

export type VoidProblem = 'void' | 'paid' | 'credited' | 'sent'

/**
 * Why an avi can't be voided, or null when it can. Voiding is only for mistakes caught before
 * the tenant received the avi; once it has been sent, it is corrected with a credit note.
 */
export function voidProblem(invoice: {
  readonly voidedAt: Date | null
  /** What payments have settled, from the ledger. */
  readonly paidOre: number
  readonly creditedOre: number
  readonly sentAt: Date | null
}): VoidProblem | null {
  if (invoice.voidedAt) return 'void'
  if (invoice.paidOre > 0) return 'paid'
  if (invoice.creditedOre > 0) return 'credited'
  if (invoice.sentAt) return 'sent'
  return null
}

export type RefundProblem = 'nothing_due' | 'future'

/**
 * Why a refund can't be recorded on `refundedOn`, or null. What is paid back is what the avi
 * was overpaid by (e.g. a credit note after payment), from the ledger.
 */
export function refundProblem(
  invoice: { readonly refundDueOre: number },
  refundedOn: string,
  today: string,
): RefundProblem | null {
  if (invoice.refundDueOre <= 0) return 'nothing_due'
  if (refundedOn > today) return 'future'
  return null
}

export type ReissueProblem = 'in_force' | 'already_replaced' | 'no_rent'

/**
 * Why no corrected avi can be issued for this avi's period, or null when one can. `others` are
 * the lease's other avier for the same period; `netOre` is the rent the lease has for it now.
 */
export function reissueProblem(
  invoice: InvoiceAmounts,
  others: readonly InvoiceAmounts[],
  netOre: number,
): ReissueProblem | null {
  if (inForce(invoice)) return 'in_force'
  if (others.some(inForce)) return 'already_replaced'
  if (netOre <= 0) return 'no_rent'
  return null
}
