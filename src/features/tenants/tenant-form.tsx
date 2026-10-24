import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer } from '#/components/form-drawer'
import { tenantKindLabels, tenantKinds } from '#/features/leases/options'
import { createTenantFn, tenantQuery, tenantsQuery, updateTenantFn } from './functions'
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

/** Used for both "Lägg till hyresgäst" and "Redigera uppgifter", each in a drawer. */
export function TenantForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
}: {
  defaultValues: CreateTenantInput
  submitLabel: string
  onSubmit: (value: CreateTenantInput) => Promise<unknown>
  error: Error | null
}) {
  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: validator },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.AppField name="kind">
        {(field) => (
          <field.SegmentedField
            label="Typ av hyresgäst"
            options={tenantKinds.map((k) => ({ value: k, label: tenantKindLabels[k] }))}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(s) => s.values.kind}>
        {(kind) => (
          <>
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label={kind === 'company' ? 'Företagsnamn' : 'Namn'}
                  autoComplete={kind === 'company' ? 'organization' : 'name'}
                  placeholder={kind === 'company' ? undefined : 'För- och efternamn'}
                />
              )}
            </form.AppField>
            {kind === 'company' && (
              <form.AppField name="organizationNumber">
                {(field) => (
                  <field.TextField
                    label="Organisationsnummer"
                    placeholder="556677-8899"
                    inputMode="numeric"
                    hint="10 siffror, med eller utan bindestreck"
                  />
                )}
              </form.AppField>
            )}
          </>
        )}
      </form.Subscribe>
      <form.AppField name="email">
        {(field) => (
          <field.TextField
            label="E-post"
            type="email"
            autoComplete="email"
            hint="Avier skickas hit. Utan e-post kan avier inte mejlas."
          />
        )}
      </form.AppField>
      <form.AppField name="phone">
        {(field) => (
          <field.TextField label={<Optional>Telefon</Optional>} type="tel" autoComplete="tel" />
        )}
      </form.AppField>
      <form.AppField name="streetAddress">
        {(field) => (
          <field.TextField
            label={<Optional>Fakturaadress</Optional>}
            autoComplete="street-address"
          />
        )}
      </form.AppField>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
        <form.AppField name="postalCode">
          {(field) => (
            <field.TextField label="Postnummer" inputMode="numeric" autoComplete="postal-code" />
          )}
        </form.AppField>
        <form.AppField name="city">
          {(field) => <field.TextField label="Ort" autoComplete="address-level2" />}
        </form.AppField>
      </div>
      {error && <p className="text-destructive text-sm">{error.message}</p>}
      <form.AppForm>
        <form.SubmitButton>{submitLabel}</form.SubmitButton>
      </form.AppForm>
    </form>
  )
}

/** "Lägg till hyresgäst": creates a tenant and refreshes the tenant list. */
export function useAddTenantDrawer() {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createTenantFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantsQuery().queryKey }),
  })
  return useFormDrawer({
    title: 'Lägg till hyresgäst',
    description: 'Koppla hyresgästen till ett avtal i nästa steg.',
    onClose: create.reset,
    form: ({ close }) => (
      <TenantForm
        defaultValues={emptyTenant}
        submitLabel="Spara hyresgäst"
        error={create.error}
        onSubmit={async (value) => {
          await create.mutateAsync({ data: value })
          close()
        }}
      />
    ),
  })
}

/** "Redigera uppgifter" on the tenant page. */
export function useEditTenantDrawer(tenant: Parameters<typeof tenantToInput>[0] & { id: string }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: updateTenantFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(tenantQuery(tenant.id).queryKey, updated)
      await queryClient.invalidateQueries({ queryKey: tenantsQuery().queryKey })
      await queryClient.invalidateQueries({ queryKey: ['leases'] })
    },
  })
  return useFormDrawer({
    title: 'Redigera uppgifter',
    description:
      'Ändringar gäller nya avier. Redan skapade avier behåller uppgifterna de skapades med.',
    onClose: update.reset,
    form: ({ close }) => (
      <TenantForm
        defaultValues={tenantToInput(tenant)}
        submitLabel="Spara ändringar"
        error={update.error}
        onSubmit={async (value) => {
          await update.mutateAsync({ data: { tenantId: tenant.id, ...value } })
          close()
        }}
      />
    ),
  })
}
