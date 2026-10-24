import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { m } from '#/paraglide/messages'
import { createPropertyFn, propertiesQuery } from './functions'
import { type CreatePropertyInput, CreatePropertyInput as PropertySchema } from './schemas'

const validator = Schema.toStandardSchemaV1(PropertySchema)

export const emptyProperty: CreatePropertyInput = {
  designation: '',
  name: '',
  streetAddress: '',
  postalCode: '',
  city: '',
}

/** Shared by "Lägg till fastighet" (in a drawer) and the edit page. */
export function PropertyForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
  disabled = false,
}: {
  defaultValues: CreatePropertyInput
  submitLabel: string
  onSubmit: (value: CreatePropertyInput) => Promise<unknown>
  error: Error | null
  disabled?: boolean
}) {
  const drawer = useFormDrawerContext()
  const inDrawer = drawer !== null
  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: validator },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form
      id={drawer?.formId}
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) void form.handleSubmit()
      }}
    >
      <fieldset disabled={disabled} className="grid gap-4">
        <div className={inDrawer ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
          <form.AppField name="designation">
            {(field) => (
              <field.TextField
                label={m.property_form_designation()}
                placeholder="Uppsala Kungsängen 12:3"
              />
            )}
          </form.AppField>
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                label={<Optional>{m.common_name()}</Optional>}
                placeholder="Kv. Lärkan"
              />
            )}
          </form.AppField>
        </div>
        <form.AppField name="streetAddress">
          {(field) => (
            <field.TextField label={m.common_street_address()} autoComplete="street-address" />
          )}
        </form.AppField>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
          <form.AppField name="postalCode">
            {(field) => (
              <field.TextField
                label={m.common_postal_code()}
                inputMode="numeric"
                autoComplete="postal-code"
              />
            )}
          </form.AppField>
          <form.AppField name="city">
            {(field) => <field.TextField label={m.common_city()} autoComplete="address-level2" />}
          </form.AppField>
        </div>
        {error && <p className="text-destructive text-sm">{error.message}</p>}
        {!disabled && (
          <form.AppForm>
            <form.SubmitButton>{submitLabel}</form.SubmitButton>
          </form.AppForm>
        )}
      </fieldset>
    </form>
  )
}

/** "Lägg till fastighet": creates a property and refreshes the property list. */
export function useAddPropertyDrawer() {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createPropertyFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: propertiesQuery().queryKey }),
  })
  return useFormDrawer({
    title: m.property_add(),
    description: m.property_add_description(),
    onClose: create.reset,
    form: ({ close }) => (
      <PropertyForm
        defaultValues={emptyProperty}
        submitLabel={m.property_save()}
        error={create.error}
        onSubmit={async (value) => {
          await create.mutateAsync({ data: value })
          close()
        }}
      />
    ),
  })
}
