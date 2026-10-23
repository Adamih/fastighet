import { Schema } from 'effect'
import { tenantKinds } from '#/features/leases/options'
import { Email, OptionalText, PostalCode, RequiredText } from '#/lib/schemas'
import { isValidOrganizationNumber } from './organization-number'

export const CreateTenantInput = Schema.Struct({
  kind: Schema.Literals(tenantKinds),
  name: RequiredText('Ange ett namn'),
  organizationNumber: Schema.String.check(
    Schema.makeFilter((s: string) => s.trim() === '' || isValidOrganizationNumber(s), {
      message: 'Ogiltigt organisationsnummer',
    }),
  ),
  email: Email,
  phone: OptionalText,
  streetAddress: OptionalText,
  postalCode: PostalCode,
  city: OptionalText,
})
export type CreateTenantInput = typeof CreateTenantInput.Type

export const TenantIdInput = Schema.Struct({ tenantId: Schema.String })

export const UpdateTenantInput = Schema.Struct({
  tenantId: Schema.String,
  ...CreateTenantInput.fields,
})
export type UpdateTenantInput = typeof UpdateTenantInput.Type
