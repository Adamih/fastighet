import { useForm } from '@tanstack/react-form'
import { optionsFrom, SelectField } from '#/components/select-field'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { type UnitKind, unitKindLabels } from './unit-kinds'

export interface UnitValues {
  kind: UnitKind
  label: string
  areaSqm: number | null
}

export const emptyUnit: UnitValues = { kind: 'apartment', label: '', areaSqm: null }

const parseArea = (value: string) => (value.trim() ? Number(value.replace(',', '.')) : null)
const areaToInput = (area: number | null) => (area == null ? '' : String(area).replace('.', ','))

/** Shared by "Lägg till objekt" and the unit edit page. */
export function UnitForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
  resetAfterSubmit = false,
}: {
  defaultValues: UnitValues
  submitLabel: string
  onSubmit: (value: UnitValues) => Promise<unknown>
  error: Error | null
  resetAfterSubmit?: boolean
}) {
  const form = useForm({
    defaultValues: {
      kind: defaultValues.kind,
      label: defaultValues.label,
      area: areaToInput(defaultValues.areaSqm),
    },
    onSubmit: async ({ value, formApi }) => {
      await onSubmit({ kind: value.kind, label: value.label, areaSqm: parseArea(value.area) })
      if (resetAfterSubmit) formApi.reset()
    },
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <form.Field
          name="label"
          validators={{
            onSubmit: ({ value }) => (value.trim() ? undefined : 'Ange objektsnummer'),
          }}
        >
          {(field) => <TextField field={field} label="Objektsnummer" placeholder="1001" />}
        </form.Field>
        <form.Field name="kind">
          {(field) => (
            <SelectField field={field} label="Typ" options={optionsFrom(unitKindLabels)} />
          )}
        </form.Field>
      </div>
      <form.Field
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
        {(field) => <TextField field={field} label="Yta (m²)" placeholder="72,5" />}
      </form.Field>
      {error && <p className="text-destructive text-sm">{error.message}</p>}
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" disabled={isSubmitting} className="justify-self-start">
            {submitLabel}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
