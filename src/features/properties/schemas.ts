import { Schema } from 'effect'
import { isValidDesignation } from './designation'
import { unitKinds } from './unit-kinds'

// Shared by the client forms (TanStack Form) and the server functions (input validation).

const OptionalText = Schema.String.check(Schema.isMaxLength(200))

export const CreatePropertyInput = Schema.Struct({
  designation: Schema.String.check(
    Schema.makeFilter(isValidDesignation, {
      message: 'Ange en fastighetsbeteckning, t.ex. "Uppsala Kungsängen 12:3"',
    }),
  ),
  name: OptionalText,
  streetAddress: OptionalText,
  postalCode: Schema.String.check(
    Schema.isPattern(/^(\d{3} ?\d{2})?$/, { message: 'Postnummer har fem siffror' }),
  ),
  city: OptionalText,
})
export type CreatePropertyInput = typeof CreatePropertyInput.Type

export const PropertyIdInput = Schema.Struct({ propertyId: Schema.String })

export const CreateUnitInput = Schema.Struct({
  propertyId: Schema.String,
  kind: Schema.Literals(unitKinds),
  label: Schema.String.check(Schema.isMinLength(1, { message: 'Ange ett objektsnummer' })),
  areaSqm: Schema.NullOr(Schema.Number.check(Schema.isGreaterThan(0))),
})
export type CreateUnitInput = typeof CreateUnitInput.Type
