import { Schema } from 'effect'
import { IsoDate } from '#/lib/schemas'

/** A new rent (or a bostadsrätt's fee) from a date. */
export const ChangeBaseChargeInput = Schema.Struct({
  agreementId: Schema.String,
  fromDate: IsoDate,
  amountOre: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type ChangeBaseChargeInput = typeof ChangeBaseChargeInput.Type
