import { Effect } from 'effect'
import { type FeeTerms, loadFeeTerms } from '#/features/settings/program'
import { maxDate } from '#/lib/dates'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { type BrfFeeKind, feeFor } from './fees'

const basisPointsOf = (kind: BrfFeeKind, terms: FeeTerms) =>
  kind === 'pledge_fee' ? terms.pledgeFeeBasisPoints : terms.transferFeeBasisPoints

/**
 * The one-off charge for a pantsättningsavgift or överlåtelseavgift on `date`, to insert with
 * what it is charged for; null when the company doesn't charge it or the board skips it. It is
 * dated no earlier than the bostadsrätt's first day, so its first avi bills it. Fails when the
 * prisbasbelopp for the year isn't known yet.
 */
export const feeCharge = Effect.fn('ownerships.feeCharge')(function* (
  kind: BrfFeeKind,
  terms: FeeTerms,
  input: {
    readonly charge: boolean
    readonly date: string
    readonly agreement: { readonly id: string; readonly startDate: string }
    readonly description: string
  },
) {
  const basisPoints = basisPointsOf(kind, terms)
  if (!input.charge || basisPoints === null) return null
  const fee = feeFor(basisPoints, terms.priceBaseAmounts, input.date)
  if ('missing' in fee) {
    return yield* new Conflict({
      message: `Prisbasbeloppet för ${fee.missing} finns inte än. Avstå från avgiften eller vänta tills det är fastställt.`,
    })
  }
  return {
    agreementId: input.agreement.id,
    kind,
    description: input.description,
    amountOre: fee.ore,
    interval: 'once' as const,
    // A BRF's fees from its members are outside VAT.
    vat: false,
    fromDate: maxDate(input.date, input.agreement.startDate),
  }
})

/** The fee terms for the pledge and sale forms' previews; only those who register them need it. */
export const getFeeTerms = requirePermission({ lease: ['manage'] }).pipe(
  Effect.andThen(loadFeeTerms),
)
