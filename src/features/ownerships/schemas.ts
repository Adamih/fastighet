import { Schema } from 'effect'
import { invoiceIntervals } from '#/features/leases/options'
import { IsoDate } from '#/lib/schemas'

export const OwnershipIdInput = Schema.Struct({ ownershipId: Schema.String })

const Owners = Schema.Array(
  Schema.Struct({ partyId: Schema.String, sharePercent: Schema.Int }),
).check(Schema.isMinLength(1, { message: 'Välj minst en ägare' }))

/** A bostadsrätt: its owners, the apartment (and any storage or parking), and the fee. */
export const CreateOwnershipInput = Schema.Struct({
  owners: Owners,
  /** Who receives the avier; null means the first owner. */
  invoiceRecipientId: Schema.NullOr(Schema.String),
  unitIds: Schema.Array(Schema.String).check(
    Schema.isMinLength(1, { message: 'Välj minst ett objekt' }),
  ),
  /** Tillträdesdag: the owners' first day, and the first day that is billed. */
  startDate: IsoDate,
  /** Månadsavgift, in öre. */
  feeOre: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  invoiceInterval: Schema.Literals(invoiceIntervals),
  /** Andelstal in percent of the association's total. */
  shareRatio: Schema.NullOr(Schema.Number.check(Schema.isGreaterThan(0))),
  /** Insats, in öre. */
  depositOre: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  /** Upplåtelsedatum: when the right was first granted. */
  grantedOn: Schema.NullOr(IsoDate),
})
export type CreateOwnershipInput = typeof CreateOwnershipInput.Type

export const UpdateOwnershipInput = Schema.Struct({
  ownershipId: Schema.String,
  ...CreateOwnershipInput.fields,
})
export type UpdateOwnershipInput = typeof UpdateOwnershipInput.Type

/** A sale (överlåtelse): the buyers take over from `transferDate`. */
export const TransferOwnershipInput = Schema.Struct({
  ownershipId: Schema.String,
  transferDate: IsoDate,
  owners: Owners,
  invoiceRecipientId: Schema.NullOr(Schema.String),
})
export type TransferOwnershipInput = typeof TransferOwnershipInput.Type
