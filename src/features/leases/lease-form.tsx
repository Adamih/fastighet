import { FieldError, Optional, optionsFrom, useAppForm } from '#/components/form'
import { type UnitKind, unitKindLabels } from '#/features/properties/unit-kinds'
import { isIsoDate } from '#/lib/dates'
import { oreToInput, parseSek } from '#/lib/money'
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
  onSubmit: ({ value }: { value: string }) => (isIsoDate(value) ? undefined : 'Ange ett datum'),
}
const wholeMonths = {
  onSubmit: ({ value }: { value: string }) =>
    /^\d+$/.test(value.trim()) ? undefined : 'Ange antal månader',
}

/** Shared by "Nytt avtal" (with tenant picker) and the lease edit page (tenant fixed). */
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
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) void form.handleSubmit()
      }}
    >
      <fieldset disabled={disabled} className="grid gap-6">
        {tenants && (
          <form.AppField name="tenantId" validators={required('Välj en hyresgäst')}>
            {(field) => (
              <field.SelectField
                disabled={disabled}
                label="Hyresgäst"
                placeholder="Välj hyresgäst"
                options={tenants.map((t) => ({ value: t.id, label: t.name }))}
              />
            )}
          </form.AppField>
        )}

        <form.AppField
          name="unitIds"
          validators={{
            onSubmit: ({ value }) => (value.length > 0 ? undefined : 'Välj minst ett objekt'),
          }}
        >
          {(field) => (
            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium text-sm">Objekt</legend>
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
          <h2 className="font-medium">Avtalstid</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="startDate" validators={date}>
              {(field) => <field.TextField label="Tillträde" type="date" />}
            </form.AppField>
            <form.AppField name="noticePeriodMonths" validators={wholeMonths}>
              {(field) => <field.TextField label="Uppsägningstid (månader)" inputMode="numeric" />}
            </form.AppField>
          </div>
          <p className="text-muted-foreground text-sm">
            Bostäder har normalt 3 månaders uppsägningstid, lokaler 9 månader.
          </p>
          <form.AppField name="fixedTerm">
            {(field) => (
              <field.SwitchField
                disabled={disabled}
                label="Tidsbestämt avtal"
                description="Avtalet har ett slutdatum och kan förlängas automatiskt."
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(s) => s.values.fixedTerm}>
            {(fixedTerm) =>
              fixedTerm && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.AppField name="endDate" validators={date}>
                    {(field) => <field.TextField label="Avtalet löper till" type="date" />}
                  </form.AppField>
                  <form.AppField
                    name="extensionMonths"
                    validators={{
                      onSubmit: ({ value }) =>
                        value.trim() === '' || /^[1-9]\d*$/.test(value.trim())
                          ? undefined
                          : 'Ange antal månader eller lämna tomt',
                    }}
                  >
                    {(field) => (
                      <field.TextField
                        label={<Optional>Förlängning (månader)</Optional>}
                        placeholder="Tomt = ingen förlängning"
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
          <h2 className="font-medium">Hyra</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField
              name="rent"
              validators={{
                onSubmit: ({ value }) =>
                  parseSek(value) === null ? 'Ange ett belopp, t.ex. 8 450' : undefined,
              }}
            >
              {(field) => (
                <field.TextField label="Belopp (kr)" placeholder="8 450" inputMode="decimal" />
              )}
            </form.AppField>
            <form.AppField name="rentInterval">
              {(field) => (
                <field.SelectField
                  disabled={disabled}
                  label="Avser"
                  options={optionsFrom(rentIntervalLabels)}
                />
              )}
            </form.AppField>
            <form.AppField name="invoiceInterval">
              {(field) => (
                <field.SelectField
                  disabled={disabled}
                  label="Avisering"
                  options={optionsFrom(invoiceIntervalLabels)}
                />
              )}
            </form.AppField>
          </div>
          <form.AppField name="vat">
            {(field) => (
              <field.SwitchField
                disabled={disabled}
                label="Momspliktig uthyrning"
                description="25 % moms läggs på hyran."
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
