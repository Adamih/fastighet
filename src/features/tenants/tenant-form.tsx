import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { optionsFrom, SelectField } from '#/components/select-field'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { tenantKindLabels } from '#/features/leases/options'
import { type CreateTenantInput, CreateTenantInput as TenantSchema } from './schemas'

const validator = Schema.toStandardSchemaV1(TenantSchema)

export const emptyTenant: CreateTenantInput = {
  kind: 'company',
  name: '',
  organizationNumber: '',
  email: '',
  phone: '',
  streetAddress: '',
  postalCode: '',
  city: '',
}

/** Turns a stored tenant (nullable fields) into form values. */
export const tenantToInput = (t: {
  kind: CreateTenantInput['kind']
  name: string
  organizationNumber: string | null
  email: string | null
  phone: string | null
  streetAddress: string | null
  postalCode: string | null
  city: string | null
}): CreateTenantInput => ({
  kind: t.kind,
  name: t.name,
  organizationNumber: t.organizationNumber ?? '',
  email: t.email ?? '',
  phone: t.phone ?? '',
  streetAddress: t.streetAddress ?? '',
  postalCode: t.postalCode ?? '',
  city: t.city ?? '',
})

/** Shared by "Lägg till hyresgäst" and the tenant page. */
export function TenantForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
  disabled = false,
  resetAfterSubmit = false,
}: {
  defaultValues: CreateTenantInput
  submitLabel: string
  onSubmit: (value: CreateTenantInput) => Promise<unknown>
  error: Error | null
  disabled?: boolean
  resetAfterSubmit?: boolean
}) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: validator },
    onSubmit: async ({ value, formApi }) => {
      await onSubmit(value)
      if (resetAfterSubmit) formApi.reset()
    },
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) void form.handleSubmit()
      }}
    >
      <fieldset disabled={disabled} className="grid gap-4">
        <form.Field name="kind">
          {(field) => (
            <SelectField
              disabled={disabled}
              field={field}
              label="Typ"
              options={optionsFrom(tenantKindLabels)}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.values.kind}>
          {(kind) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="name">
                {(field) => (
                  <TextField field={field} label={kind === 'company' ? 'Företagsnamn' : 'Namn'} />
                )}
              </form.Field>
              {kind === 'company' && (
                <form.Field name="organizationNumber">
                  {(field) => (
                    <TextField
                      field={field}
                      label="Organisationsnummer"
                      placeholder="556677-8899"
                    />
                  )}
                </form.Field>
              )}
            </div>
          )}
        </form.Subscribe>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="email">
            {(field) => <TextField field={field} label="E-post" type="email" />}
          </form.Field>
          <form.Field name="phone">
            {(field) => <TextField field={field} label="Telefon" type="tel" />}
          </form.Field>
        </div>
        <form.Field name="streetAddress">
          {(field) => <TextField field={field} label="Fakturaadress" />}
        </form.Field>
        <div className="grid grid-cols-[8rem_1fr] gap-4">
          <form.Field name="postalCode">
            {(field) => <TextField field={field} label="Postnummer" />}
          </form.Field>
          <form.Field name="city">{(field) => <TextField field={field} label="Ort" />}</form.Field>
        </div>
        {error && <p className="text-destructive text-sm">{error.message}</p>}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-11 w-full sm:h-9 sm:w-auto sm:justify-self-start"
            >
              {submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </fieldset>
    </form>
  )
}
