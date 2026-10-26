import { formatSek } from '#/lib/money'
import type { ParsedPayment } from './camt054'

// How an imported payment relates to the company's invoices. Pure, so it can be unit-tested.

export const paymentStatuses = ['matched', 'review', 'unmatched', 'ignored'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  matched: 'Matchad',
  review: 'Kontrollera',
  unmatched: 'Ej matchad',
  ignored: 'Ignorerad',
}

export interface InvoiceForMatching {
  readonly id: string
  readonly number: number
  readonly ocr: string
  /** What is still owed, from the ledger: after credit notes and earlier payments. */
  readonly owedOre: number
  readonly status: 'open' | 'paid' | 'credited' | 'void'
  readonly paidOn: string | null
}

export interface MatchResult {
  readonly status: PaymentStatus
  /** The invoice the payment belongs to; on `review`, the invoice it most likely belongs to. */
  readonly invoiceId: string | null
  /** Whether the import should allocate the payment to the invoice (which settles it). */
  readonly allocates: boolean
  readonly note: string | null
}

/**
 * Matches payments to invoices by OCR. A payment is only booked automatically when the OCR points
 * at an open invoice and the amount is exactly what is still owed; anything doubtful is left for
 * a person to review. Payments are matched in order, so a second payment for the same invoice is
 * flagged.
 */
export function matchPayments(
  payments: readonly ParsedPayment[],
  invoicesByOcr: ReadonlyMap<string, InvoiceForMatching>,
): MatchResult[] {
  const paidInThisFile = new Set<string>()

  return payments.map((p): MatchResult => {
    const ocr = p.reference?.replace(/\D/g, '') ?? ''
    const inv = ocr ? invoicesByOcr.get(ocr) : undefined
    if (!inv) return { status: 'unmatched', invoiceId: null, allocates: false, note: null }

    const review = (note: string): MatchResult => ({
      status: 'review',
      invoiceId: inv.id,
      allocates: false,
      note,
    })
    if (inv.status === 'void') return review(`Avi ${inv.number} är makulerad`)
    if (inv.status === 'paid') return review(`Avi ${inv.number} är redan betald (${inv.paidOn})`)
    if (inv.status === 'credited') return review(`Avi ${inv.number} är krediterad`)
    if (paidInThisFile.has(inv.id)) return review(`Avi ${inv.number} betalas två gånger i filen`)
    if (p.amountOre !== inv.owedOre) {
      const kind = p.amountOre < inv.owedOre ? 'Delbetalning' : 'Överbetalning'
      return review(
        `${kind}: ${formatSek(p.amountOre)} av ${formatSek(inv.owedOre)} på avi ${inv.number}`,
      )
    }

    paidInThisFile.add(inv.id)
    return { status: 'matched', invoiceId: inv.id, allocates: true, note: null }
  })
}
