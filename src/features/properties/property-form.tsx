import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Schema } from 'effect'
import { DeleteButton } from '#/components/delete-button'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { m } from '#/paraglide/messages'
import {
  createPropertyFn,
  deletePropertyFn,
  type getPropertyFn,
  propertiesQuery,
  propertyQuery,
  updatePropertyFn,
} from './functions'
import { type CreatePropertyInput, CreatePropertyInput as PropertySchema } from './schemas'

const validator = Schema.toStandardSchemaV1(PropertySchema)

export const emptyProperty: CreatePropertyInput = {
  designation: '',
  name: '',
  streetAddress: '',
  postalCode: '',
  city: '',
}

/** Shared by the create and edit property drawers. */
export function PropertyForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
}: {
  defaultValues: CreatePropertyInput
  submitLabel: string
  onSubmit: (value: CreatePropertyInput) => Promise<unknown>
  error: Error | null
}) {
  const drawer = useFormDrawerContext()
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
        void form.handleSubmit().catch(() => {})
      }}
    >
      <fieldset className="grid gap-4">
        <div className="grid gap-4">
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
        <form.AppForm>
          <form.SubmitButton>{submitLabel}</form.SubmitButton>
        </form.AppForm>
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

/** "Ändra" on a property's page. */
export function useEditPropertyDrawer(property: Awaited<ReturnType<typeof getPropertyFn>>) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['properties'] })
    await queryClient.invalidateQueries({ queryKey: ['units'] })
    await queryClient.invalidateQueries({ queryKey: ['leases'] })
  }
  const update = useMutation({
    mutationFn: updatePropertyFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(propertyQuery(property.id).queryKey, updated)
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: deletePropertyFn,
    onSuccess: async () => {
      await navigate({ to: '/' })
      queryClient.removeQueries({ queryKey: propertyQuery(property.id).queryKey })
      await refresh()
    },
  })
  const leased = property.units.some((u) => u.occupancy)
  return useFormDrawer({
    title: m.property_edit_title(),
    onClose: () => {
      update.reset()
      remove.reset()
    },
    form: ({ close }) => (
      <div className="grid gap-6">
        <PropertyForm
          defaultValues={{
            designation: property.designation,
            name: property.name ?? '',
            streetAddress: property.streetAddress ?? '',
            postalCode: property.postalCode ?? '',
            city: property.city ?? '',
          }}
          submitLabel={m.common_save_changes()}
          error={update.error}
          onSubmit={async (value) => {
            await update.mutateAsync({ data: { propertyId: property.id, ...value } })
            close()
          }}
        />
        <section className="grid gap-2 border-t pt-5 text-sm">
          <h2 className="font-medium">{m.common_delete()}</h2>
          <p className="text-muted-foreground">
            {leased
              ? m.property_delete_blocked()
              : m.property_delete_warning({ count: property.units.length })}
          </p>
          {!leased && (
            <DeleteButton
              label={m.property_delete()}
              question={m.common_delete_named({ name: property.designation })}
              pending={remove.isPending}
              onConfirm={() => remove.mutate({ data: { propertyId: property.id } })}
            />
          )}
          {remove.error && <p className="text-destructive">{remove.error.message}</p>}
        </section>
      </div>
    ),
  })
}
