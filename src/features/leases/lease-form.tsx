import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { DeleteButton } from '#/components/delete-button'
import { Optional, optionsFrom, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { SubmissionForm } from '#/components/submission-form'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { MAX_PARTIES } from '#/features/agreements/parties'
import { UnitsField } from '#/features/agreements/units-field'
import { useCan } from '#/features/auth/use-can'
import { unitsQuery } from '#/features/properties/functions'
import type { UnitKind } from '#/features/properties/unit-kinds'
import { tenantsQuery } from '#/features/tenants/functions'
import { isIsoDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { oreToInput, parseSek } from '#/lib/money'
import { rich } from '#/lib/rich'
import { m } from '#/paraglide/messages'
import { createLeaseFn, deleteLeaseFn, leaseQuery, leasesQuery, updateLeaseFn } from './functions'
import {
  type InvoiceInterval,
  invoiceIntervalLabels,
  type RentInterval,
  rentIntervalLabels,
} from './options'
import type { LeaseView } from './program'

/** What the form produces; `tenantId` is only set when the form shows the tenant picker. */
export interface LeaseFormValues {
  tenantId: string
  coTenantIds: string[]
  /** Null means the tenant receives the avier. */
  invoiceRecipientId: string | null
  unitIds: string[]
  startDate: string
  termEndDate: string | null
  extensionMonths: number | null
  noticePeriodMonths: number
  rentOre: number
  rentInterval: RentInterval
  invoiceInterval: InvoiceInterval
  vat: boolean
}

export const emptyLease: LeaseFormValues = {
  tenantId: '',
  coTenantIds: [],
  invoiceRecipientId: null,
  unitIds: [],
  startDate: '',
  termEndDate: null,
  extensionMonths: 36,
  noticePeriodMonths: 3,
  rentOre: 0,
  rentInterval: 'monthly',
  invoiceInterval: 'monthly',
  vat: false,
}

const required = (message: string) => ({
  onSubmit: ({ value }: { value: string }) => (value.trim() ? undefined : message),
})
const date = {
  onSubmit: ({ value }: { value: string }) =>
    isIsoDate(value) ? undefined : m.common_date_required(),
}
const wholeMonths = {
  onSubmit: ({ value }: { value: string }) =>
    /^\d+$/.test(value.trim()) ? undefined : m.lease_form_months_required(),
}

/** Shared by the create (with tenant picker) and edit (tenant fixed) lease drawers. */
export function LeaseForm({
  tenants,
  tenantPicker,
  units,
  defaultValues,
  submitLabel,
  onSubmit,
}: {
  /** Every tenant, for the pickers. */
  tenants: readonly { id: string; name: string }[]
  /** False when editing: the tenant is fixed, co-tenants can still change. */
  tenantPicker: boolean
  units: readonly { id: string; label: string; kind: UnitKind; designation: string }[]
  defaultValues: LeaseFormValues
  submitLabel: string
  onSubmit: (value: LeaseFormValues) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues: {
      tenantId: defaultValues.tenantId,
      coTenantIds: defaultValues.coTenantIds,
      invoiceRecipientId: defaultValues.invoiceRecipientId ?? '',
      unitIds: defaultValues.unitIds,
      startDate: defaultValues.startDate,
      fixedTerm: defaultValues.termEndDate !== null,
      termEndDate: defaultValues.termEndDate ?? '',
      extensionMonths:
        defaultValues.extensionMonths === null ? '' : String(defaultValues.extensionMonths),
      noticePeriodMonths: String(defaultValues.noticePeriodMonths),
      rent: defaultValues.rentOre > 0 ? oreToInput(defaultValues.rentOre) : '',
      rentInterval: defaultValues.rentInterval,
      invoiceInterval: defaultValues.invoiceInterval,
      vat: defaultValues.vat,
    },
    onSubmit: ({ value }) =>
      onSubmit({
        tenantId: value.tenantId,
        // A co-tenant picked as the tenant isn't also a co-tenant.
        coTenantIds: value.coTenantIds.filter((id) => id !== value.tenantId),
        invoiceRecipientId:
          value.invoiceRecipientId && value.invoiceRecipientId !== value.tenantId
            ? value.invoiceRecipientId
            : null,
        unitIds: value.unitIds,
        startDate: value.startDate,
        termEndDate: value.fixedTerm ? value.termEndDate : null,
        extensionMonths:
          value.fixedTerm && value.extensionMonths.trim() ? Number(value.extensionMonths) : null,
        noticePeriodMonths: Number(value.noticePeriodMonths),
        rentOre: parseSek(value.rent) ?? 0,
        rentInterval: value.rentInterval,
        invoiceInterval: value.invoiceInterval,
        vat: value.vat,
      }),
  })

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-6">
      <fieldset className="grid gap-6">
        {tenantPicker && (
          <form.AppField name="tenantId" validators={required(m.lease_form_tenant_required())}>
            {(field) => (
              <field.SelectField
                label={m.lease_form_tenant()}
                placeholder={m.lease_form_tenant_placeholder()}
                options={tenants.map((t) => ({ value: t.id, label: t.name }))}
              />
            )}
          </form.AppField>
        )}

        <form.Subscribe selector={(s) => s.values.tenantId}>
          {(tenantId) => (
            <form.AppField name="coTenantIds">
              {(field) => {
                const nameOf = (id: string) => tenants.find((t) => t.id === id)?.name ?? ''
                const chosen = field.state.value.filter((id) => id !== tenantId)
                const available = tenants.filter((t) => t.id !== tenantId && !chosen.includes(t.id))
                const remove = (id: string) => {
                  field.handleChange(field.state.value.filter((other) => other !== id))
                  if (form.getFieldValue('invoiceRecipientId') === id) {
                    form.setFieldValue('invoiceRecipientId', '')
                  }
                }
                return (
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 font-medium text-sm">
                      <Optional>{m.lease_form_co_tenants()}</Optional>
                    </legend>
                    {chosen.length > 0 && (
                      <ul className="grid gap-1.5">
                        {chosen.map((id) => (
                          <li
                            key={id}
                            className="flex items-center justify-between gap-2 rounded-md border py-1 pr-1 pl-3 text-sm"
                          >
                            <span className="truncate">{nameOf(id)}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-11 sm:size-8"
                              aria-label={m.lease_form_remove_co_tenant({ name: nameOf(id) })}
                              onClick={() => remove(id)}
                            >
                              <X aria-hidden="true" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {available.length > 0 && chosen.length < MAX_PARTIES - 1 && (
                      // Picking a name adds it; the picker then resets to its placeholder.
                      <Select value="" onValueChange={(id) => field.handleChange([...chosen, id])}>
                        <SelectTrigger
                          aria-label={m.lease_form_add_co_tenant()}
                          className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9"
                        >
                          <SelectValue placeholder={m.lease_form_add_co_tenant()} />
                        </SelectTrigger>
                        <SelectContent>
                          {available.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <p className="text-muted-foreground text-sm">
                      {m.lease_form_co_tenants_hint()}
                    </p>
                  </fieldset>
                )
              }}
            </form.AppField>
          )}
        </form.Subscribe>

        <form.Subscribe
          selector={(s) => [s.values.tenantId, s.values.coTenantIds.join(',')] as const}
        >
          {([tenantId, coTenants]) => {
            const ids = [tenantId, ...coTenants.split(',')].filter(Boolean)
            if (!tenantId || ids.length < 2) return null
            const options = [...new Set(ids)].map((id) => ({
              value: id,
              label: tenants.find((t) => t.id === id)?.name ?? '',
            }))
            return (
              <form.AppField name="invoiceRecipientId">
                {(field) => (
                  <div className="grid gap-1.5">
                    <field.SelectField
                      label={m.lease_form_invoice_recipient()}
                      // Blank means the tenant, so the tenant's name stands in until another is chosen.
                      placeholder={options[0].label}
                      options={options}
                    />
                    <p className="text-muted-foreground text-sm">
                      {m.lease_form_invoice_recipient_hint()}
                    </p>
                  </div>
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

        <section className="grid gap-4">
          <h2 className="font-medium">{m.lease_form_term()}</h2>
          <div className="grid gap-4">
            <form.AppField name="startDate" validators={date}>
              {(field) => <field.TextField label={m.lease_form_start()} type="date" />}
            </form.AppField>
            <form.AppField name="noticePeriodMonths" validators={wholeMonths}>
              {(field) => (
                <field.TextField label={m.lease_form_notice_period()} inputMode="numeric" />
              )}
            </form.AppField>
          </div>
          <p className="text-muted-foreground text-sm">{m.lease_form_notice_period_hint()}</p>
          <form.AppField name="fixedTerm">
            {(field) => (
              <field.SwitchField
                label={m.lease_form_fixed_term()}
                description={m.lease_form_fixed_term_description()}
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(s) => s.values.fixedTerm}>
            {(fixedTerm) =>
              fixedTerm && (
                <div className="grid gap-4">
                  <form.AppField name="termEndDate" validators={date}>
                    {(field) => <field.TextField label={m.lease_form_end()} type="date" />}
                  </form.AppField>
                  <form.AppField
                    name="extensionMonths"
                    validators={{
                      onSubmit: ({ value }) =>
                        value.trim() === '' || /^[1-9]\d*$/.test(value.trim())
                          ? undefined
                          : m.lease_form_extension_invalid(),
                    }}
                  >
                    {(field) => (
                      <field.TextField
                        label={<Optional>{m.lease_form_extension()}</Optional>}
                        placeholder={m.lease_form_extension_placeholder()}
                        inputMode="numeric"
                      />
                    )}
                  </form.AppField>
                </div>
              )
            }
          </form.Subscribe>
        </section>

        <section className="grid gap-4">
          <h2 className="font-medium">{m.lease_form_rent_section()}</h2>
          <div className="grid gap-4">
            <form.AppField
              name="rent"
              validators={{
                onSubmit: ({ value }) =>
                  parseSek(value) === null ? m.lease_form_rent_invalid() : undefined,
              }}
            >
              {(field) => (
                <field.TextField
                  label={m.lease_form_rent()}
                  placeholder="8 450"
                  inputMode="decimal"
                />
              )}
            </form.AppField>
            <form.AppField name="rentInterval">
              {(field) => (
                <field.SelectField
                  label={m.lease_form_rent_interval()}
                  options={optionsFrom(rentIntervalLabels)}
                />
              )}
            </form.AppField>
            <form.AppField name="invoiceInterval">
              {(field) => (
                <field.SelectField
                  label={m.lease_form_invoice_interval()}
                  options={optionsFrom(invoiceIntervalLabels)}
                />
              )}
            </form.AppField>
          </div>
          <form.AppField name="vat">
            {(field) => (
              <field.SwitchField
                label={m.lease_form_vat()}
                description={m.lease_form_vat_description()}
              />
            )}
          </form.AppField>
        </section>

        <form.AppForm>
          <form.SubmitButton>{submitLabel}</form.SubmitButton>
        </form.AppForm>
      </fieldset>
    </SubmissionForm>
  )
}

/** "Nytt avtal" on the lease list or a unit's page. */
export function useAddLeaseDrawer(unitId?: string) {
  const queryClient = useQueryClient()
  const canCreate = useCan()({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const tenants = useQuery({ ...tenantsQuery(), enabled: canCreate })
  const units = useQuery({ ...unitsQuery(), enabled: canCreate })
  const create = useFormMutation({
    mutationFn: createLeaseFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries(
        { queryKey: leasesQuery().queryKey },
        { throwOnError: true },
      )
      await queryClient.invalidateQueries({ queryKey: ['properties'] }, { throwOnError: true })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] }, { throwOnError: true })
      await queryClient.invalidateQueries({ queryKey: ['units'] }, { throwOnError: true })
    },
  })
  return useFormDrawer({
    size: 'wide',
    title: m.lease_new(),
    onClose: create.reset,
    form: ({ close }) => {
      const error = tenants.error ?? units.error
      if (error)
        return (
          <QueryError
            error={error}
            pending={tenants.isFetching || units.isFetching}
            retry={() => Promise.all([tenants.refetch(), units.refetch()])}
          />
        )
      if (!tenants.data || !units.data) {
        return <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
      }
      if (tenants.data.length === 0 || units.data.length === 0) {
        return (
          <p className="text-muted-foreground text-sm">
            {rich(
              (link) => m.lease_new_missing({ link }),
              tenants.data.length === 0 ? (
                <Link to="/tenants" className="underline">
                  {m.lease_new_add_tenant()}
                </Link>
              ) : (
                <Link to="/" className="underline">
                  {m.lease_new_add_unit()}
                </Link>
              ),
            )}
          </p>
        )
      }
      return (
        <LeaseForm
          tenants={tenants.data}
          tenantPicker
          units={units.data}
          defaultValues={{
            ...emptyLease,
            unitIds: unitId && units.data.some((u) => u.id === unitId) ? [unitId] : [],
          }}
          submitLabel={m.lease_create()}
          onSubmit={async (value) => {
            await create.mutateAsync({ data: value })
            close()
          }}
        />
      )
    },
  })
}

/** Fetch the unit and tenant choices only when an edit drawer is opened. */
function EditLeaseForm({
  lease,
  onSubmit,
}: {
  lease: LeaseView
  onSubmit: (value: LeaseFormValues) => Promise<unknown>
}) {
  const units = useQuery(unitsQuery())
  const tenants = useQuery(tenantsQuery())
  const failed = units.error ? units : tenants.error ? tenants : null
  if (failed)
    return (
      <QueryError error={failed.error} pending={failed.isFetching} retry={() => failed.refetch()} />
    )
  if (!units.data || !tenants.data) {
    return <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
  }
  const receiver = lease.parties.find((p) => p.receivesInvoices)
  return (
    <LeaseForm
      tenants={tenants.data}
      tenantPicker={false}
      units={units.data}
      defaultValues={{
        tenantId: lease.tenant.id,
        coTenantIds: lease.parties.filter((p) => p.id !== lease.tenant.id).map((p) => p.id),
        invoiceRecipientId: receiver && receiver.id !== lease.tenant.id ? receiver.id : null,
        unitIds: lease.units.map((u) => u.id),
        startDate: lease.startDate,
        termEndDate: lease.termEndDate,
        extensionMonths: lease.extensionMonths,
        noticePeriodMonths: lease.noticePeriodMonths,
        rentOre: lease.rentOre,
        rentInterval: lease.rentInterval,
        invoiceInterval: lease.invoiceInterval,
        vat: lease.vat,
      }}
      submitLabel={m.common_save_changes()}
      onSubmit={onSubmit}
    />
  )
}

/** "Ändra" on the lease page and "Ändra avtal" in the lease list. */
export function useEditLeaseDrawer(lease: LeaseView) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['leases'] }, { throwOnError: true })
    await queryClient.invalidateQueries({ queryKey: ['properties'] }, { throwOnError: true })
    await queryClient.invalidateQueries({ queryKey: ['tenants'] }, { throwOnError: true })
    await queryClient.invalidateQueries({ queryKey: ['units'] }, { throwOnError: true })
  }
  const update = useFormMutation({
    mutationFn: updateLeaseFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(leaseQuery(lease.id).queryKey, updated)
      await refresh()
    },
  })
  const remove = useFormMutation({
    mutationFn: deleteLeaseFn,
    onSuccess: async () => {
      await navigate({ to: '/leases' })
      queryClient.removeQueries({ queryKey: leaseQuery(lease.id).queryKey })
      await refresh()
    },
  })
  return useFormDrawer({
    size: 'wide',
    title: m.lease_edit_title({ number: lease.number }),
    description: m.lease_edit_intro({ tenant: lease.partyNames }),
    onClose: () => {
      update.reset()
      remove.reset()
    },
    form: ({ close }) => (
      <div className="grid gap-6">
        <EditLeaseForm
          lease={lease}
          onSubmit={async ({ tenantId: _tenantId, ...value }) => {
            await update.mutateAsync({ data: { leaseId: lease.id, ...value } })
            close()
          }}
        />
        <section className="grid gap-2 border-t pt-5 text-sm">
          <h2 className="font-medium">{m.common_delete()}</h2>
          <p className="text-muted-foreground">{m.lease_delete_rule()}</p>
          <DeleteButton
            label={m.lease_delete()}
            question={m.lease_delete_confirm({ number: lease.number })}
            pending={remove.isPending}
            onConfirm={() => remove.mutate({ data: { leaseId: lease.id } })}
          />
          {remove.error && <p className="text-destructive">{remove.error.message}</p>}
        </section>
      </div>
    ),
  })
}
