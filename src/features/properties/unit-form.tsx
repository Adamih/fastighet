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
  disabled = false,
  resetAfterSubmit = false,
  idPrefix = '',
  layout = 'wide',
}: {
  defaultValues: UnitValues
  submitLabel: string
  onSubmit: (value: UnitValues) => Promise<unknown>
  error: Error | null
  disabled?: boolean
  resetAfterSubmit?: boolean
  /** Keeps ids unique when the form can be on the page twice (card and phone drawer). */
  idPrefix?: string
  /** `narrow` gives a full-width submit button, for drawers. */
  layout?: 'wide' | 'narrow'
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
        if (!disabled) void form.handleSubmit()
      }}
    >
      <fieldset disabled={disabled} className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <form.Field
            name="label"
            validators={{
              onSubmit: ({ value }) => (value.trim() ? undefined : 'Ange objektsnummer'),
            }}
          >
            {(field) => (
              <TextField
                field={field}
                id={`${idPrefix}label`}
                label="Objektsnummer"
                placeholder="1001"
              />
            )}
          </form.Field>
          <form.Field name="kind">
            {(field) => (
              <SelectField
                disabled={disabled}
                field={field}
                id={`${idPrefix}kind`}
                label="Typ"
                options={optionsFrom(unitKindLabels)}
              />
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
          {(field) => (
            <TextField
              field={field}
              id={`${idPrefix}area`}
              label={
                <span>
                  Yta (m²) <span className="font-normal text-muted-foreground">(valfritt)</span>
                </span>
              }
              placeholder="72,5"
              inputMode="decimal"
            />
          )}
        </form.Field>
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
