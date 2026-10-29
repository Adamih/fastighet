import { Schema } from 'effect'
import { Email, OptionalText, PostalCode } from '#/lib/schemas'

export const PartyIdInput = Schema.Struct({ partyId: Schema.String })

export const InvitePortalUserInput = Schema.Struct({
  partyId: Schema.String,
  email: Email.check(
    Schema.makeFilter((s: string) => s.trim().length > 0, { message: 'Ange en e-postadress' }),
  ),
})
export type InvitePortalUserInput = typeof InvitePortalUserInput.Type

export const InvitationIdInput = Schema.Struct({ invitationId: Schema.String })

export const AccessIdInput = Schema.Struct({ accessId: Schema.String })

export const UpdatePortalContactInput = Schema.Struct({
  partyId: Schema.String,
  email: Email,
  phone: OptionalText,
  streetAddress: OptionalText,
  postalCode: PostalCode,
  city: OptionalText,
})
export type UpdatePortalContactInput = typeof UpdatePortalContactInput.Type
