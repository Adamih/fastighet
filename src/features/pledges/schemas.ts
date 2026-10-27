import { Schema } from 'effect'
import { isValidOrganizationNumber } from '#/features/tenants/organization-number'
import { Email, IsoDate, OptionalText, RequiredText } from '#/lib/schemas'

/** A lender's notice of a pledge, registered on a bostadsrätt. */
export const RegisterPledgeInput = Schema.Struct({
  ownershipId: Schema.String,
  creditorName: RequiredText('Ange långivaren'),
  creditorOrganizationNumber: Schema.String.check(
    Schema.makeFilter((s: string) => s.trim() === '' || isValidOrganizationNumber(s), {
      message: 'Ogiltigt organisationsnummer',
    }),
  ),
  reference: OptionalText,
  notifiedOn: IsoDate,
  note: OptionalText,
  /** Charge the pantsättningsavgift, if the förening charges one; the board can skip it. */
  chargeFee: Schema.optional(Schema.Boolean),
  /** Where the lender wants the confirmation; blank means none is emailed now. */
  confirmationEmail: Schema.optional(Email),
})
export type RegisterPledgeInput = typeof RegisterPledgeInput.Type

export const ReleasePledgeInput = Schema.Struct({
  pledgeId: Schema.String,
  releasedOn: IsoDate,
  note: OptionalText,
})
export type ReleasePledgeInput = typeof ReleasePledgeInput.Type

/** What a confirmation to the lender confirms: the registration or the release. */
export const confirmationKinds = ['registered', 'released'] as const
export type ConfirmationKind = (typeof confirmationKinds)[number]

export const PledgeConfirmationInput = Schema.Struct({
  pledgeId: Schema.String,
  kind: Schema.Literals(confirmationKinds),
})
export type PledgeConfirmationInput = typeof PledgeConfirmationInput.Type

/** Sends the confirmation by email, or (blank email) records that it went by post. */
export const ConfirmPledgeInput = Schema.Struct({
  ...PledgeConfirmationInput.fields,
  email: Email,
})
export type ConfirmPledgeInput = typeof ConfirmPledgeInput.Type
