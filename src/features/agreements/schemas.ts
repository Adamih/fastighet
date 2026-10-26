import { Schema } from 'effect'
import { IsoDate } from '#/lib/schemas'

/** A new rent (or a bostadsrätt's fee) from a date. */
export const ChangeBaseChargeInput = Schema.Struct({
  agreementId: Schema.String,
  fromDate: IsoDate,
  amountOre: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type ChangeBaseChargeInput = typeof ChangeBaseChargeInput.Type

/** A one-off amount on the next avi whose period covers `fromDate`; negative for a reduction. */
export const AddOneOffChargeInput = Schema.Struct({
  agreementId: Schema.String,
  description: Schema.String.check(
    Schema.isMinLength(1, { message: 'Ange vad beloppet gäller' }),
    Schema.isMaxLength(120),
  ),
  amountOre: Schema.Int.check(
    Schema.makeFilter((n: number) => n !== 0, { message: 'Ange ett belopp' }),
  ),
  fromDate: IsoDate,
  vat: Schema.Boolean,
})
export type AddOneOffChargeInput = typeof AddOneOffChargeInput.Type

export const ChargeIdInput = Schema.Struct({ chargeId: Schema.String })
