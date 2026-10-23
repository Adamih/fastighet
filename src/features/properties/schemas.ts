import { Schema } from 'effect'
import { OptionalText, PostalCode } from '#/lib/schemas'
import { isValidDesignation } from './designation'
import { unitKinds } from './unit-kinds'

// Shared by the client forms (TanStack Form) and the server functions (input validation).

export const CreatePropertyInput = Schema.Struct({
  designation: Schema.String.check(
    Schema.makeFilter(isValidDesignation, {
      message: 'Ange en fastighetsbeteckning, t.ex. "Uppsala Kungsängen 12:3"',
    }),
  ),
  name: OptionalText,
  streetAddress: OptionalText,
  postalCode: PostalCode,
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

export const UpdatePropertyInput = Schema.Struct({
  propertyId: Schema.String,
  ...CreatePropertyInput.fields,
})
export type UpdatePropertyInput = typeof UpdatePropertyInput.Type

export const UnitIdInput = Schema.Struct({ unitId: Schema.String })

/** A unit stays on its property; only its own fields change. */
export const UpdateUnitInput = Schema.Struct({
  unitId: Schema.String,
  kind: CreateUnitInput.fields.kind,
  label: CreateUnitInput.fields.label,
  areaSqm: CreateUnitInput.fields.areaSqm,
})
export type UpdateUnitInput = typeof UpdateUnitInput.Type
