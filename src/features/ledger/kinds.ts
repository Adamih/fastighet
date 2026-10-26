// Client-safe constants for the receivables ledger (kundreskontra).

/**
 * Accounts in a company's ledger. Amounts on entries are signed: debit positive, credit
 * negative, and every posting sums to zero.
 * - `receivable`: what payers owe, one open item per avi (or a party's credit balance).
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
] as const
export type PostingKind = (typeof postingKinds)[number]
