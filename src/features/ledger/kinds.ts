// Client-safe constants for the receivables ledger (kundreskontra).

/**
 * Accounts in a company's ledger. Amounts on entries are signed: debit positive, credit
 * negative, and every posting sums to zero.
 * - `receivable`: what payers owe: one open item per avi, and per party the entries without an
 *   avi, whose sum (negative) is the party's credit balance (tillgodo).
 * - `income`: rent and fees, per charge kind; `output_vat`: VAT on them.
 * - `bank`: money in or out of the bankgiro.
 * - `unallocated`: payments received but not yet matched to an avi.
 */
export const ledgerAccounts = ['receivable', 'income', 'output_vat', 'bank', 'unallocated'] as const
export type LedgerAccount = (typeof ledgerAccounts)[number]

/**
 * What a posting records. A reversal has the same kind as what it reverses, with negated
 * entries, so sums by kind stay right.
 */
export const postingKinds = [
  'invoice',
  'credit_note',
  'void',
  'payment',
  'allocation',
  'manual_payment',
  'refund',
  // A reminder's fee added to the reminded avi's receivable: no longer written (fees are charges
  // the next avi bills), kept for postings from before.
  'reminder',
  // Moves between an avi and its party's credit balance: credit used on a new avi, and what an
  // avi was overpaid by (e.g. after a credit note) moved to the credit balance.
  'credit_use',
  'credit_transfer',
] as const
export type PostingKind = (typeof postingKinds)[number]
