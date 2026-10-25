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
  readonly paidOn: string | null
  readonly creditedOre: number
  readonly sentAt: Date | null
}): VoidProblem | null {
  if (invoice.voidedAt) return 'void'
  if (invoice.paidOn) return 'paid'
  if (invoice.creditedOre > 0) return 'credited'
  if (invoice.sentAt) return 'sent'
  return null
}

interface RefundableNote {
  readonly totalOre: number
  /** Credited after the invoice was paid, so the amount goes back to the tenant. */
  readonly refund: boolean
  readonly refundedOn: string | null
}

/** What the credit notes on an invoice still have to pay back, and what has been paid back. */
export function refunds(notes: readonly RefundableNote[]) {
  const toRefund = notes.filter((n) => n.refund)
  const sum = (list: readonly RefundableNote[]) => list.reduce((s, n) => s + n.totalOre, 0)
  return {
    refundDueOre: sum(toRefund.filter((n) => n.refundedOn === null)),
    refundedOre: sum(toRefund.filter((n) => n.refundedOn !== null)),
  }
}

export type RefundProblem = 'not_refund' | 'already_refunded' | 'future' | 'before_credit'

/** Why a refund can't be recorded on `refundedOn`, or null when it can. */
export function refundProblem(
  note: RefundableNote & { readonly issueDate: string },
  refundedOn: string,
  today: string,
): RefundProblem | null {
  if (!note.refund) return 'not_refund'
  if (note.refundedOn) return 'already_refunded'
  if (refundedOn > today) return 'future'
  if (refundedOn < note.issueDate) return 'before_credit'
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
