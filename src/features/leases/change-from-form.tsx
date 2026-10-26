import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { SubmissionForm } from '#/components/submission-form'
import { UnitsField } from '#/features/agreements/units-field'
import { useCan } from '#/features/auth/use-can'
import { unitsQuery } from '#/features/properties/functions'
import type { UnitKind } from '#/features/properties/unit-kinds'
import { tenantsQuery } from '#/features/tenants/functions'
import { isIsoDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'
import { CoTenantsField, receiverOptions } from './co-tenants-field'
import { changeLeaseFromFn, leaseQuery } from './functions'
import type { LeaseView } from './program'

interface ChangeFromValues {
  fromDate: string
  coTenantIds: string[]
  /** Blank means the tenant receives the avier. */
  invoiceRecipientId: string
  unitIds: string[]
}

/**
 * Co-tenants, who receives the avier, and units from a date, starting from how they are now.
 * The tenant is fixed: a new tenant is a new lease.
 */
export function ChangeFromForm({
  lease,
  tenants,
  units,
  onSubmit,
}: {
  lease: LeaseView
  tenants: readonly { id: string; name: string }[]
  units: readonly { id: string; label: string; kind: UnitKind; designation: string }[]
  onSubmit: (value: {
    fromDate: string
    coTenantIds: string[]
    invoiceRecipientId: string | null
    unitIds: string[]
  }) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const tenantId = lease.tenant.id
  const receiver = lease.parties.find((p) => p.receivesInvoices)
  const form = useAppForm({
    defaultValues: {
      fromDate: '',
      coTenantIds: lease.parties.filter((p) => p.id !== tenantId).map((p) => p.id),
      invoiceRecipientId: receiver && receiver.id !== tenantId ? receiver.id : '',
      unitIds: lease.units.map((u) => u.id),
    } as ChangeFromValues,
    onSubmit: ({ value }) =>
      onSubmit({
        fromDate: value.fromDate,
        coTenantIds: value.coTenantIds.filter((id) => id !== tenantId),
        invoiceRecipientId:
          value.invoiceRecipientId && value.coTenantIds.includes(value.invoiceRecipientId)
            ? value.invoiceRecipientId
            : null,
        unitIds: value.unitIds,
      }),
  })

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-6">
      <form.AppField
        name="fromDate"
        validators={{
          onSubmit: ({ value }) => (isIsoDate(value) ? undefined : m.common_date_required()),
        }}
      >
        {(field) => <field.TextField label={m.lease_change_from_date()} type="date" />}
      </form.AppField>
      <form.AppField name="coTenantIds">
        {() => (
          <CoTenantsField
            tenants={tenants}
            tenantId={tenantId}
            onRemove={(id) => {
              if (form.getFieldValue('invoiceRecipientId') === id) {
                form.setFieldValue('invoiceRecipientId', '')
              }
            }}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(s) => s.values.coTenantIds.join(',')}>
        {(coTenants) => {
          const options = receiverOptions(tenantId, coTenants.split(','), tenants)
          if (options.length < 2) return null
          return (
            <form.AppField name="invoiceRecipientId">
              {(field) => (
                <field.SelectField
                  label={m.lease_form_invoice_recipient()}
                  placeholder={options[0].label}
                  options={options}
                />
              )}
            </form.AppField>
          )
        }}
      </form.Subscribe>
      <form.AppField
        name="unitIds"
        validators={{
          onSubmit: ({ value }) => (value.length > 0 ? undefined : m.lease_form_units_required()),
        }}
      >
        {() => <UnitsField label={m.lease_form_units()} units={units} />}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton>{m.lease_change_from_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Ändra från datum" on the lease page. */
export function useChangeLeaseFromDrawer(lease: LeaseView) {
  const queryClient = useQueryClient()
  const enabled = useCan()({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const tenants = useQuery({ ...tenantsQuery(), enabled })
  const units = useQuery({ ...unitsQuery(), enabled })
  const change = useFormMutation({
    mutationFn: changeLeaseFromFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(leaseQuery(lease.id).queryKey, updated)
      for (const queryKey of [['leases'], ['tenants'], ['properties'], ['units']]) {
        await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
      }
    },
  })
  return useFormDrawer({
    size: 'wide',
    title: m.lease_change_from_title(),
    description: m.lease_change_from_description(),
    onClose: change.reset,
    form: ({ close }) => {
      const error = tenants.error ?? units.error
      if (error) {
        return (
          <QueryError
            error={error}
            pending={tenants.isFetching || units.isFetching}
            retry={() => Promise.all([tenants.refetch(), units.refetch()])}
          />
        )
      }
      if (!tenants.data || !units.data) {
        return <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
      }
      return (
        <ChangeFromForm
          lease={lease}
          tenants={tenants.data}
          units={units.data}
          onSubmit={async (value) => {
            await change.mutateAsync({ data: { leaseId: lease.id, ...value } })
            close()
          }}
        />
      )
    },
  })
}
