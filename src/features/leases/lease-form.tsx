import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FieldError, Optional, optionsFrom, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { useCan } from '#/features/auth/use-can'
import { unitsQuery } from '#/features/properties/functions'
import { type UnitKind, unitKindLabels } from '#/features/properties/unit-kinds'
import { tenantsQuery } from '#/features/tenants/functions'
import { isIsoDate } from '#/lib/dates'
import { oreToInput, parseSek } from '#/lib/money'
import { rich } from '#/lib/rich'
import { m } from '#/paraglide/messages'
import { createLeaseFn, leasesQuery } from './functions'
import {
  type InvoiceInterval,
  invoiceIntervalLabels,
  type RentInterval,
  rentIntervalLabels,
} from './options'

/** What the form produces; `tenantId` is only set when the form shows the tenant picker. */
export interface LeaseFormValues {
  tenantId: string
  unitIds: string[]
  startDate: string
  endDate: string | null
  extensionMonths: number | null
  noticePeriodMonths: number
  rentOre: number
  rentInterval: RentInterval
  invoiceInterval: InvoiceInterval
  vat: boolean
}

export const emptyLease: LeaseFormValues = {
  tenantId: '',
  unitIds: [],
  startDate: '',
  endDate: null,
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

/** Shared by "Nytt avtal" (in a drawer, with tenant picker) and the lease edit page (tenant fixed). */
export function LeaseForm({
  tenants,
  units,
  defaultValues,
  submitLabel,
  onSubmit,
  error,
  disabled = false,
}: {
  /** Omit to hide the tenant picker. */
  tenants?: readonly { id: string; name: string }[]
  units: readonly { id: string; label: string; kind: UnitKind; designation: string }[]
  defaultValues: LeaseFormValues
  submitLabel: string
  onSubmit: (value: LeaseFormValues) => Promise<unknown>
  error: Error | null
  disabled?: boolean
}) {
  const drawer = useFormDrawerContext()
  const inDrawer = drawer !== null
  const form = useAppForm({
    defaultValues: {
      tenantId: defaultValues.tenantId,
      unitIds: defaultValues.unitIds,
      startDate: defaultValues.startDate,
      fixedTerm: defaultValues.endDate !== null,
      endDate: defaultValues.endDate ?? '',
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
        unitIds: value.unitIds,
        startDate: value.startDate,
        endDate: value.fixedTerm ? value.endDate : null,
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
    <form
      id={drawer?.formId}
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) void form.handleSubmit()
      }}
    >
      <fieldset disabled={disabled} className="grid gap-6">
        {tenants && (
          <form.AppField name="tenantId" validators={required(m.lease_form_tenant_required())}>
            {(field) => (
              <field.SelectField
                disabled={disabled}
                label={m.lease_form_tenant()}
                placeholder={m.lease_form_tenant_placeholder()}
                options={tenants.map((t) => ({ value: t.id, label: t.name }))}
              />
            )}
          </form.AppField>
        )}

        <form.AppField
          name="unitIds"
          validators={{
            onSubmit: ({ value }) => (value.length > 0 ? undefined : m.lease_form_units_required()),
          }}
        >
          {(field) => (
            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium text-sm">{m.lease_form_units()}</legend>
              <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-3">
                {units.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={field.state.value.includes(u.id)}
                      onChange={(e) =>
                        field.handleChange(
                          e.target.checked
                            ? [...field.state.value, u.id]
                            : field.state.value.filter((id) => id !== u.id),
                        )
                      }
                    />
                    <span>
                      {u.designation} · <span className="font-medium">{u.label}</span>{' '}
                      <span className="text-muted-foreground">({unitKindLabels[u.kind]})</span>
                    </span>
                  </label>
                ))}
              </div>
              <FieldError />
            </fieldset>
          )}
        </form.AppField>

        <section className="grid gap-4">
          <h2 className="font-medium">{m.lease_form_term()}</h2>
          <div className={inDrawer ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
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
                disabled={disabled}
                label={m.lease_form_fixed_term()}
                description={m.lease_form_fixed_term_description()}
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(s) => s.values.fixedTerm}>
            {(fixedTerm) =>
              fixedTerm && (
                <div className={inDrawer ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
                  <form.AppField name="endDate" validators={date}>
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
          <div className={inDrawer ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
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
                  disabled={disabled}
                  label={m.lease_form_rent_interval()}
                  options={optionsFrom(rentIntervalLabels)}
                />
              )}
            </form.AppField>
            <form.AppField name="invoiceInterval">
              {(field) => (
                <field.SelectField
                  disabled={disabled}
                  label={m.lease_form_invoice_interval()}
                  options={optionsFrom(invoiceIntervalLabels)}
                />
              )}
            </form.AppField>
          </div>
          <form.AppField name="vat">
            {(field) => (
              <field.SwitchField
                disabled={disabled}
                label={m.lease_form_vat()}
                description={m.lease_form_vat_description()}
              />
            )}
          </form.AppField>
        </section>

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

/** "Nytt avtal" on the lease list or a unit's page. */
export function useAddLeaseDrawer(unitId?: string) {
  const queryClient = useQueryClient()
  const canCreate = useCan()({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const tenants = useQuery({ ...tenantsQuery(), enabled: canCreate })
  const units = useQuery({ ...unitsQuery(), enabled: canCreate })
  const create = useMutation({
    mutationFn: createLeaseFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: leasesQuery().queryKey })
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
      await queryClient.invalidateQueries({ queryKey: ['units'] })
    },
  })
  return useFormDrawer({
    title: m.lease_new(),
    onClose: create.reset,
    form: ({ close }) => {
      const error = tenants.error ?? units.error
      if (error) return <p className="text-destructive text-sm">{error.message}</p>
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
          units={units.data}
          defaultValues={{
            ...emptyLease,
            unitIds: unitId && units.data.some((u) => u.id === unitId) ? [unitId] : [],
          }}
          submitLabel={m.lease_create()}
          error={create.error}
          onSubmit={async (value) => {
            await create.mutateAsync({ data: value })
            close()
          }}
        />
      )
    },
  })
}
