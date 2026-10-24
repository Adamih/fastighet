import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import { useFormDrawer } from '#/components/form-drawer'
import { SegmentedControl } from '#/components/segmented-control'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
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

/** Shared by "Lägg till hyresgäst" and the tenant page. */
export function TenantForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
  disabled = false,
  resetAfterSubmit = false,
  idPrefix = '',
  layout = 'wide',
}: {
  defaultValues: CreateTenantInput
  submitLabel: string
  onSubmit: (value: CreateTenantInput) => Promise<unknown>
  error: Error | null
  disabled?: boolean
  resetAfterSubmit?: boolean
  /** Keeps ids unique when the form can be on the page twice (side panel and phone sheet). */
  idPrefix?: string
  /** `narrow` stacks every field, for side panels and sheets. */
  layout?: 'wide' | 'narrow'
}) {
  const pair = layout === 'wide' ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-4'
  const id = (name: string) => `${idPrefix}${name}`
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
            <SegmentedControl
              label="Typ av hyresgäst"
              name={id('kind')}
              disabled={disabled}
              value={field.state.value}
              options={tenantKinds.map((k) => ({ value: k, label: tenantKindLabels[k] }))}
              onChange={(kind) => field.handleChange(kind)}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.values.kind}>
          {(kind) => (
            <div className={pair}>
              <form.Field name="name">
                {(field) => (
                  <TextField
                    field={field}
                    id={id('name')}
                    label={kind === 'company' ? 'Företagsnamn' : 'Namn'}
                    autoComplete={kind === 'company' ? 'organization' : 'name'}
                    placeholder={kind === 'company' ? undefined : 'För- och efternamn'}
                  />
                )}
              </form.Field>
              {kind === 'company' && (
                <form.Field name="organizationNumber">
                  {(field) => (
                    <TextField
                      field={field}
                      id={id('organizationNumber')}
                      label="Organisationsnummer"
                      placeholder="556677-8899"
                      inputMode="numeric"
                      hint="10 siffror, med eller utan bindestreck"
                    />
                  )}
                </form.Field>
              )}
            </div>
          )}
        </form.Subscribe>
        <div className={pair}>
          <form.Field name="email">
            {(field) => (
              <TextField
                field={field}
                id={id('email')}
                label="E-post"
                type="email"
                autoComplete="email"
                hint="Avier skickas hit. Utan e-post kan avier inte mejlas."
              />
            )}
          </form.Field>
          <form.Field name="phone">
            {(field) => (
              <TextField
                field={field}
                id={id('phone')}
                label={<Optional>Telefon</Optional>}
                type="tel"
                autoComplete="tel"
              />
            )}
          </form.Field>
        </div>
        <form.Field name="streetAddress">
          {(field) => (
            <TextField
              field={field}
              id={id('streetAddress')}
              label={<Optional>Fakturaadress</Optional>}
              autoComplete="street-address"
            />
          )}
        </form.Field>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
          <form.Field name="postalCode">
            {(field) => (
              <TextField
                field={field}
                id={id('postalCode')}
                label="Postnummer"
                inputMode="numeric"
                autoComplete="postal-code"
              />
            )}
          </form.Field>
          <form.Field name="city">
            {(field) => (
              <TextField field={field} id={id('city')} label="Ort" autoComplete="address-level2" />
            )}
          </form.Field>
        </div>
        {error && <p className="text-destructive text-sm">{error.message}</p>}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button
              type="submit"
              disabled={isSubmitting}
              className={
                layout === 'wide'
                  ? 'h-11 w-full sm:h-9 sm:w-auto sm:justify-self-start'
                  : 'h-11 w-full sm:h-10'
              }
            >
              {submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </fieldset>
    </form>
  )
}

function Optional({ children }: { children: string }) {
  return (
    <span>
      {children} <span className="font-normal text-muted-foreground">(valfritt)</span>
    </span>
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
        idPrefix="add-tenant-"
        layout="narrow"
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
        idPrefix="edit-tenant-"
        layout="narrow"
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
