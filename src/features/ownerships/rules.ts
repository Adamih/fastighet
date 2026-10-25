import { addDays } from '#/lib/dates'

// Pure rules for bostadsrätter. Shared by the server (checks) and the UI (previews).

export type TransferProblem = 'ended' | 'too_early'

/**
 * Why a bostadsrätt can't be transferred on `transferDate` (the buyers' first day), or null.
 * The sellers' last day becomes the day before.
 */
export function transferProblem(
  ownership: { startDate: string; endDate: string | null },
  transferDate: string,
): TransferProblem | null {
  if (ownership.endDate) return 'ended'
  if (transferDate <= ownership.startDate) return 'too_early'
  return null
}

/** The sellers' last day. */
export const sellersLastDay = (transferDate: string) => addDays(transferDate, -1)

/**
 * Avier to the sellers that cover days from the transfer on. They were issued in advance, so
 * the part after the sellers' last day should be credited; the buyers' first avi covers it.
 */
export function invoicedPastTransfer<
  I extends { periodEnd: string; status: 'void' | 'paid' | 'credited' | 'overdue' | 'unpaid' },
>(invoices: readonly I[], transferDate: string): I[] {
  return invoices.filter(
    (i) => i.status !== 'void' && i.status !== 'credited' && i.periodEnd >= transferDate,
  )
}

/** "2,145 %" from a stored andelstal (a percentage of the association's total). */
export function formatShareRatio(ratio: number): string {
  return `${ratio.toLocaleString('sv-SE', { maximumFractionDigits: 4 })} %`
}
