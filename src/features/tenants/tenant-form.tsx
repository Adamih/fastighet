import { useQueryClient } from '@tanstack/react-query'
import { Schema } from 'effect'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { tenantKindLabels, tenantKinds } from '#/features/leases/options'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'
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
}: {
  defaultValues: CreateTenantInput
  submitLabel: string
  onSubmit: (value: CreateTenantInput) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: validator },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.AppField name="kind">
        {(field) => (
          <field.SegmentedField
            label={m.tenant_form_kind()}
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
                  label={kind === 'company' ? m.tenant_form_company_name() : m.common_name()}
                  autoComplete={kind === 'company' ? 'organization' : 'name'}
                  placeholder={
                    kind === 'company' ? undefined : m.tenant_form_person_name_placeholder()
                  }
                />
              )}
            </form.AppField>
            {kind === 'company' && (
              <form.AppField name="organizationNumber">
                {(field) => (
                  <field.TextField
                    label={m.common_organization_number()}
                    placeholder="556677-8899"
                    inputMode="numeric"
                    hint={m.tenant_form_organization_number_hint()}
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
            label={m.common_email()}
            type="email"
            autoComplete="email"
            hint={m.tenant_form_email_hint()}
          />
        )}
      </form.AppField>
      <form.AppField name="phone">
        {(field) => (
          <field.TextField
            label={<Optional>{m.common_phone()}</Optional>}
            type="tel"
            autoComplete="tel"
          />
        )}
      </form.AppField>
      <form.AppField name="streetAddress">
        {(field) => (
          <field.TextField
            label={<Optional>{m.tenant_form_billing_address()}</Optional>}
            autoComplete="street-address"
          />
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

      <form.AppForm>
        <form.SubmitButton>{submitLabel}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Lägg till hyresgäst": creates a tenant and refreshes the tenant list. */
export function useAddTenantDrawer() {
  const queryClient = useQueryClient()
  const create = useFormMutation({
    mutationFn: createTenantFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tenantsQuery().queryKey }, { throwOnError: true }),
  })
  return useFormDrawer({
    title: m.tenant_add(),
    description: m.tenant_add_description(),
    onClose: create.reset,
    form: ({ close }) => (
      <TenantForm
        defaultValues={emptyTenant}
        submitLabel={m.tenant_save()}
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
  const update = useFormMutation({
    mutationFn: updateTenantFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(tenantQuery(tenant.id).queryKey, updated)
      await queryClient.invalidateQueries(
        { queryKey: tenantsQuery().queryKey },
        { throwOnError: true },
      )
      await queryClient.invalidateQueries({ queryKey: ['leases'] }, { throwOnError: true })
    },
  })
  return useFormDrawer({
    title: m.tenant_edit(),
    description: m.tenant_edit_description(),
    onClose: update.reset,
    form: ({ close }) => (
      <TenantForm
        defaultValues={tenantToInput(tenant)}
        submitLabel={m.common_save_changes()}
        onSubmit={async (value) => {
          await update.mutateAsync({ data: { tenantId: tenant.id, ...value } })
          close()
        }}
      />
    ),
  })
}
