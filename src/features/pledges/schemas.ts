import { Schema } from 'effect'
import { isValidOrganizationNumber } from '#/features/tenants/organization-number'
import { IsoDate, OptionalText, RequiredText } from '#/lib/schemas'

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
})
export type RegisterPledgeInput = typeof RegisterPledgeInput.Type

export const ReleasePledgeInput = Schema.Struct({
  pledgeId: Schema.String,
  releasedOn: IsoDate,
  note: OptionalText,
})
export type ReleasePledgeInput = typeof ReleasePledgeInput.Type
