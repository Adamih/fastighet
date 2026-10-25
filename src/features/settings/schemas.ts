import { Schema } from 'effect'
import { isValidBankgiro } from '#/features/invoicing/rules'
import { isValidOrganizationNumber } from '#/features/tenants/organization-number'
import { Email, OptionalText, PostalCode } from '#/lib/schemas'
import { companyKinds } from './company-kinds'

export const UpdateSettingsInput = Schema.Struct({
  organizationNumber: Schema.String.check(
    Schema.makeFilter((s: string) => s.trim() === '' || isValidOrganizationNumber(s), {
      message: 'Ogiltigt organisationsnummer',
    }),
  ),
  bankgiro: Schema.String.check(
    Schema.makeFilter((s: string) => s.trim() === '' || isValidBankgiro(s), {
      message: 'Ogiltigt bankgironummer',
    }),
  ),
  streetAddress: OptionalText,
  postalCode: PostalCode,
  city: OptionalText,
  email: Email,
  phone: OptionalText,
  fSkatt: Schema.Boolean,
  kind: Schema.Literals(companyKinds),
})
export type UpdateSettingsInput = typeof UpdateSettingsInput.Type

export const SetCompanyKindInput = Schema.Struct({ kind: Schema.Literals(companyKinds) })
