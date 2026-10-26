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

/** What is left of a bank payment once the party's avier are settled: their credit balance. */
export const creditAllocationEntries = (paymentId: string, amountOre: number): EntryDraft[] =>
  balanced([
    { account: 'unallocated', amountOre, paymentId },
    { account: 'receivable', amountOre: -amountOre, paymentId },
  ])

/** The party's credit balance pays part (or all) of a new avi. */
export const creditUseEntries = (invoiceId: string, amountOre: number): EntryDraft[] =>
  balanced([
    { account: 'receivable', amountOre },
    { account: 'receivable', amountOre: -amountOre, invoiceId },
  ])

/** What an avi was overpaid by (after a credit note on a paid avi) becomes credit balance. */
export const creditTransferEntries = (invoiceId: string, amountOre: number): EntryDraft[] =>
  balanced([
    { account: 'receivable', amountOre, invoiceId },
    { account: 'receivable', amountOre: -amountOre },
  ])

/** A payment registered by hand, without a bank file: straight from the bank to the avi. */
export const manualPaymentEntries = (invoiceId: string, amountOre: number): EntryDraft[] =>
  balanced([
    { account: 'bank', amountOre },
    { account: 'receivable', amountOre: -amountOre, invoiceId },
  ])

/** Paying back a party's credit balance. */
export const refundEntries = (amountOre: number): EntryDraft[] =>
  balanced([
    { account: 'receivable', amountOre },
    { account: 'bank', amountOre: -amountOre },
  ])

/** A reminder's fee (påminnelseavgift): added to what the avi owes, booked as its own income. */
export const reminderFeeEntries = (invoiceId: string, feeOre: number): EntryDraft[] =>
  balanced([
    { account: 'receivable', amountOre: feeOre, invoiceId },
    {
      account: 'income',
      amountOre: -feeOre,
      invoiceId,
      chargeKind: 'reminder_fee',
      vatRatePercent: 0,
    },
  ])

/** Reverses a posting: the same entries, negated. Used for undo and void. */
export const reversal = (entries: readonly EntryDraft[]): EntryDraft[] =>
  balanced(entries.map((e) => ({ ...e, amountOre: -e.amountOre })))

export interface ReceivableEntry {
  readonly kind: PostingKind
  readonly date: string
  readonly amountOre: number
}

const settling: readonly PostingKind[] = ['allocation', 'manual_payment', 'credit_use']

/**
 * What an avi's receivable entries add up to. Owed is everything; paid counts payments
 * (allocated or by hand), credit used counts the party's credit balance applied to it, credited
 * counts credit notes. What an avi is overpaid by moves to the credit balance in the same batch
 * (`credit_transfer`), so owed doesn't stay negative.
 */
export function invoiceMoney(entries: readonly ReceivableEntry[]) {
  const sum = (kinds: readonly PostingKind[]) =>
    entries.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.amountOre, 0)
  const owedOre = entries.reduce((s, e) => s + e.amountOre, 0)
  const paidOre = 0 - sum(['allocation', 'manual_payment'])
  const creditUsedOre = 0 - sum(['credit_use'])
  const settled = entries
    .filter((e) => settling.includes(e.kind) && e.amountOre < 0)
    .map((e) => e.date)
    .sort()
  return {
    owedOre,
    paidOre,
    creditUsedOre,
    creditedOre: 0 - sum(['credit_note']),
    /** Moved to the party's credit balance because the avi was overpaid. */
    toCreditOre: sum(['credit_transfer']),
    /** The day it was last settled, when nothing is owed and it was paid (or paid with credit). */
    paidOn: owedOre <= 0 && paidOre + creditUsedOre > 0 ? (settled.at(-1) ?? null) : null,
  }
}

export type InvoiceMoney = ReturnType<typeof invoiceMoney>

/** An avi's status from its money: void, paid, fully credited, overdue or unpaid. */
export function statusFromMoney(
  invoice: { voidedAt: Date | null; dueDate: string },
  money: Pick<InvoiceMoney, 'owedOre' | 'paidOre' | 'creditUsedOre'>,
  today: string,
): InvoiceStatus {
  if (invoice.voidedAt) return 'void'
  if (money.owedOre <= 0) return money.paidOre + money.creditUsedOre > 0 ? 'paid' : 'credited'
  return invoice.dueDate < today ? 'overdue' : 'unpaid'
}

/**
 * A party's credit balance (tillgodo) from their receivable entries without an avi: what they
 * have paid or been credited beyond what their avier owe. Never negative in practice; programs
 * refuse changes that would make it so.
 */
export const creditBalance = (entries: readonly { amountOre: number }[]) =>
  0 - entries.reduce((s, e) => s + e.amountOre, 0)
