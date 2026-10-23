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
  readonly totalOre: number
  readonly paidOn: string | null
  readonly voided: boolean
}

export interface MatchResult {
  readonly status: PaymentStatus
  /** The invoice the payment belongs to; on `review`, the invoice it most likely belongs to. */
  readonly invoiceId: string | null
  /** Whether the import should mark the invoice paid. */
  readonly marksInvoicePaid: boolean
  readonly note: string | null
}

/**
 * Matches payments to invoices by OCR. A payment is only booked automatically when the OCR points
 * at an open invoice and the amount is exact; anything doubtful is left for a person to review.
 * Payments are matched in order, so a second payment for the same invoice is flagged.
 */
export function matchPayments(
  payments: readonly ParsedPayment[],
  invoicesByOcr: ReadonlyMap<string, InvoiceForMatching>,
): MatchResult[] {
  const paidInThisFile = new Set<string>()

  return payments.map((p): MatchResult => {
    const ocr = p.reference?.replace(/\D/g, '') ?? ''
    const inv = ocr ? invoicesByOcr.get(ocr) : undefined
    if (!inv) return { status: 'unmatched', invoiceId: null, marksInvoicePaid: false, note: null }

    const review = (note: string): MatchResult => ({
      status: 'review',
      invoiceId: inv.id,
      marksInvoicePaid: false,
      note,
    })
    if (inv.voided) return review(`Avi ${inv.number} är makulerad`)
    if (inv.paidOn) return review(`Avi ${inv.number} är redan betald (${inv.paidOn})`)
    if (paidInThisFile.has(inv.id)) return review(`Avi ${inv.number} betalas två gånger i filen`)
    if (p.amountOre !== inv.totalOre) {
      const kind = p.amountOre < inv.totalOre ? 'Delbetalning' : 'Överbetalning'
      return review(
        `${kind}: ${formatSek(p.amountOre)} av ${formatSek(inv.totalOre)} på avi ${inv.number}`,
      )
    }

    paidInThisFile.add(inv.id)
    return { status: 'matched', invoiceId: inv.id, marksInvoicePaid: true, note: null }
  })
}
