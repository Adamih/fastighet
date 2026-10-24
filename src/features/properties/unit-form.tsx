import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Optional, optionsFrom, useAppForm } from '#/components/form'
import { useFormDrawer } from '#/components/form-drawer'
import { createUnitFn, propertyQuery } from './functions'
import { type UnitKind, unitKindLabels } from './unit-kinds'

export interface UnitValues {
  kind: UnitKind
  label: string
  areaSqm: number | null
}

export const emptyUnit: UnitValues = { kind: 'apartment', label: '', areaSqm: null }

const parseArea = (value: string) => (value.trim() ? Number(value.replace(',', '.')) : null)
const areaToInput = (area: number | null) => (area == null ? '' : String(area).replace('.', ','))

/** Shared by "Lägg till objekt" (in a drawer) and the unit edit page. */
export function UnitForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
  disabled = false,
}: {
  defaultValues: UnitValues
  submitLabel: string
  onSubmit: (value: UnitValues) => Promise<unknown>
  error: Error | null
  disabled?: boolean
}) {
  const form = useAppForm({
    defaultValues: {
      kind: defaultValues.kind,
      label: defaultValues.label,
      area: areaToInput(defaultValues.areaSqm),
    },
    onSubmit: ({ value }) =>
      onSubmit({ kind: value.kind, label: value.label, areaSqm: parseArea(value.area) }),
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
        <div className="grid grid-cols-2 gap-4">
          <form.AppField
            name="label"
            validators={{
              onSubmit: ({ value }) => (value.trim() ? undefined : 'Ange objektsnummer'),
            }}
          >
            {(field) => <field.TextField label="Objektsnummer" placeholder="1001" />}
          </form.AppField>
          <form.AppField name="kind">
            {(field) => (
              <field.SelectField
                label="Typ"
                disabled={disabled}
                options={optionsFrom(unitKindLabels)}
              />
            )}
          </form.AppField>
        </div>
        <form.AppField
          name="area"
          validators={{
            onSubmit: ({ value }) => {
              const area = parseArea(value)
              return area === null || (Number.isFinite(area) && area > 0)
                ? undefined
                : 'Ange yta i m², t.ex. 72,5'
            },
          }}
        >
          {(field) => (
            <field.TextField
              label={<Optional>Yta (m²)</Optional>}
              placeholder="72,5"
              inputMode="decimal"
            />
          )}
        </form.AppField>
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

/** "Lägg till objekt" on a property's page. */
export function useAddUnitDrawer(propertyId: string) {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createUnitFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: propertyQuery(propertyId).queryKey })
      await queryClient.invalidateQueries({ queryKey: ['units'] })
    },
  })
  return useFormDrawer({
    title: 'Lägg till objekt',
    description: 'Lägenheter, lokaler, parkeringar och förråd.',
    onClose: create.reset,
    form: ({ close }) => (
      <UnitForm
        defaultValues={emptyUnit}
        submitLabel="Spara objekt"
        error={create.error}
        onSubmit={async (value) => {
          await create.mutateAsync({ data: { propertyId, ...value } })
          close()
        }}
      />
    ),
  })
}
