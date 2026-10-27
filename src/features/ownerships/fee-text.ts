import { isIsoDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { m } from '#/paraglide/messages'
import { type BrfFeeKind, feeFor, formatFeePercent, type PriceBaseAmounts } from './fees'

/**
 * What the fee comes to on `date`, for the pledge and sale forms: "1 % av prisbasbeloppet 2026
 * (59 200 kr): 592 kr". Null when the company doesn't charge it or the date isn't set yet.
 */
export function feeDescription(
  terms: {
    pledgeFeeBasisPoints: number | null
    transferFeeBasisPoints: number | null
    priceBaseAmounts: PriceBaseAmounts
  },
  kind: BrfFeeKind,
  date: string,
): string | null {
  const basisPoints =
    kind === 'pledge_fee' ? terms.pledgeFeeBasisPoints : terms.transferFeeBasisPoints
  if (basisPoints === null || !isIsoDate(date)) return null
  const fee = feeFor(basisPoints, terms.priceBaseAmounts, date)
  if ('missing' in fee) return m.fee_missing({ year: String(fee.missing) })
  return m.fee_amount({
    share: formatFeePercent(basisPoints),
    year: String(fee.year),
    base: formatSekShort(fee.priceBaseAmountKr * 100),
    amount: formatSekShort(fee.ore),
  })
}
