// Pure rules for the fees a BRF may charge its members when its bylaws (stadgar) allow them:
// a pantsättningsavgift when a lender's notice of a pledge is registered, and an
// överlåtelseavgift when a bostadsrätt is sold. Bostadsrättslagen caps them at 1 % and 2.5 % of
// the prisbasbelopp for the year of the notice or the sale. Client-safe.

export const brfFeeKinds = ['pledge_fee', 'transfer_fee'] as const
export type BrfFeeKind = (typeof brfFeeKinds)[number]

/** Shares are in basis points (hundredths of a percent): 100 is 1 %. */
export const maxFeeBasisPoints: Record<BrfFeeKind, number> = {
  pledge_fee: 100,
  transfer_fee: 250,
}

/** Prisbasbelopp in whole kronor, by year. */
export type PriceBaseAmounts = Readonly<Record<number, number>>

export const feeYear = (date: string) => Number(date.slice(0, 4))

/**
 * The fee in öre: the share of the prisbasbelopp for the date's year, rounded down to whole
 * kronor so it never exceeds the share. `missing` when that year's prisbasbelopp isn't known.
 */
export function feeFor(
  basisPoints: number,
  amounts: PriceBaseAmounts,
  date: string,
): { ore: number; year: number; priceBaseAmountKr: number } | { missing: number } {
  const year = feeYear(date)
  const priceBaseAmountKr = amounts[year]
  if (priceBaseAmountKr === undefined) return { missing: year }
  return {
    ore: Math.floor((priceBaseAmountKr * basisPoints) / 10_000) * 100,
    year,
    priceBaseAmountKr,
  }
}

/** "2,5" or "2.5 %" → 250; null for anything that isn't a share with at most two decimals. */
export function parseFeePercent(text: string): number | null {
  const match = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(text.trim().replace(/\s*%$/, ''))
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

/** 250 → "2,5" (for inputs; add " %" for display). */
export const formatFeePercent = (basisPoints: number) =>
  (basisPoints / 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 })

/** Why a typed share can't be stored, or null. Blank means the fee isn't charged. */
export function feePercentProblem(kind: BrfFeeKind, text: string): 'invalid' | 'too_high' | null {
  if (!text.trim()) return null
  const basisPoints = parseFeePercent(text)
  if (basisPoints === null || basisPoints <= 0) return 'invalid'
  return basisPoints > maxFeeBasisPoints[kind] ? 'too_high' : null
}
