import type { ChargeKind } from '#/features/agreements/kinds'
import type { InvoiceStatus } from '#/features/invoicing/rules'
import type { LedgerAccount, PostingKind } from './kinds'

// Pure rules for the receivables ledger: the entries each event posts, and what an avi's
// entries add up to. Shared by the server, the seed and tests.

export interface EntryDraft {
  readonly account: LedgerAccount
  /** Debit positive, credit negative. */
  readonly amountOre: number
  readonly invoiceId?: string | null
  readonly paymentId?: string | null
  readonly chargeKind?: ChargeKind | null
  readonly vatRatePercent?: number | null
}

interface Document {
  readonly id: string
  readonly totalOre: number
  readonly vatOre: number
  readonly lines: readonly {
    kind: ChargeKind
    netOre: number
    vatRatePercent: number
    vatOre: number
  }[]
}

/** Every posting balances; anything else is a programming error. */
export function balanced(entries: readonly EntryDraft[]): EntryDraft[] {
  const sum = entries.reduce((s, e) => s + e.amountOre, 0)
  if (sum !== 0) throw new Error(`Unbalanced posting: ${sum} öre`)
  return entries.filter((e) => e.amountOre !== 0)
}

/** Issuing an avi: the receivable against income per line and output VAT per rate. */
export function invoiceEntries(invoice: Document): EntryDraft[] {
  const vatByRate = new Map<number, number>()
  for (const l of invoice.lines) {
    if (l.vatOre !== 0)
      vatByRate.set(l.vatRatePercent, (vatByRate.get(l.vatRatePercent) ?? 0) + l.vatOre)
  }
  return balanced([
    { account: 'receivable', amountOre: invoice.totalOre, invoiceId: invoice.id },
    ...invoice.lines.map((l) => ({
      account: 'income' as const,
      amountOre: -l.netOre,
      invoiceId: invoice.id,
      chargeKind: l.kind,
      vatRatePercent: l.vatRatePercent,
    })),
    ...[...vatByRate].map(([rate, vatOre]) => ({
      account: 'output_vat' as const,
      amountOre: -vatOre,
      invoiceId: invoice.id,
      vatRatePercent: rate,
    })),
  ])
}

/** A credit note: the reverse of the lines it credits, against the avi's receivable. */
export const creditNoteEntries = (invoiceId: string, note: Omit<Document, 'id'>) =>
  reversal(invoiceEntries({ ...note, id: invoiceId }))

/** A bank payment comes in, not yet matched to an avi. */
export const paymentEntries = (paymentId: string, amountOre: number): EntryDraft[] =>
  balanced([
    { account: 'bank', amountOre, paymentId },
    { account: 'unallocated', amountOre: -amountOre, paymentId },
  ])

/** Part (or all) of a bank payment settles an avi. */
export const allocationEntries = (
  paymentId: string,
  invoiceId: string,
  amountOre: number,
): EntryDraft[] =>
  balanced([
    { account: 'unallocated', amountOre, paymentId },
    { account: 'receivable', amountOre: -amountOre, invoiceId, paymentId },
  ])

/** A payment registered by hand, without a bank file: straight from the bank to the avi. */
export const manualPaymentEntries = (invoiceId: string, amountOre: number): EntryDraft[] =>
  balanced([
    { account: 'bank', amountOre },
    { account: 'receivable', amountOre: -amountOre, invoiceId },
  ])

/** Paying back what an avi was overpaid by (after a credit note on a paid avi). */
export const refundEntries = (invoiceId: string, amountOre: number): EntryDraft[] =>
  balanced([
    { account: 'receivable', amountOre, invoiceId },
    { account: 'bank', amountOre: -amountOre },
  ])

/** Reverses a posting: the same entries, negated. Used for undo and void. */
export const reversal = (entries: readonly EntryDraft[]): EntryDraft[] =>
  balanced(entries.map((e) => ({ ...e, amountOre: -e.amountOre })))

export interface ReceivableEntry {
  readonly kind: PostingKind
  readonly date: string
  readonly amountOre: number
}

/**
 * What an avi's receivable entries add up to. Owed is everything; paid counts payments
 * (allocated or by hand), credited counts credit notes, refunded what was paid back. A negative
 * owed amount was overpaid and is to be paid back.
 */
export function invoiceMoney(entries: readonly ReceivableEntry[]) {
  const sum = (kinds: readonly PostingKind[]) =>
    entries.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.amountOre, 0)
  const owedOre = entries.reduce((s, e) => s + e.amountOre, 0)
  const paidOre = 0 - sum(['allocation', 'manual_payment'])
  const payments = entries
    .filter((e) => (e.kind === 'allocation' || e.kind === 'manual_payment') && e.amountOre < 0)
    .map((e) => e.date)
    .sort()
  return {
    owedOre,
    paidOre,
    creditedOre: 0 - sum(['credit_note']),
    refundedOre: sum(['refund']),
    refundDueOre: Math.max(0, -owedOre),
    /** The day the last payment settled it, when nothing is owed and something was paid. */
    paidOn: owedOre <= 0 && paidOre > 0 ? (payments.at(-1) ?? null) : null,
  }
}

export type InvoiceMoney = ReturnType<typeof invoiceMoney>

/** An avi's status from its money: void, paid, fully credited, overdue or unpaid. */
export function statusFromMoney(
  invoice: { voidedAt: Date | null; dueDate: string },
  money: Pick<InvoiceMoney, 'owedOre' | 'paidOre'>,
  today: string,
): InvoiceStatus {
  if (invoice.voidedAt) return 'void'
  if (money.owedOre <= 0) return money.paidOre > 0 ? 'paid' : 'credited'
  return invoice.dueDate < today ? 'overdue' : 'unpaid'
}
