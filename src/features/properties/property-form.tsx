import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { type CreatePropertyInput, CreatePropertyInput as PropertySchema } from './schemas'

const validator = Schema.toStandardSchemaV1(PropertySchema)

export const emptyProperty: CreatePropertyInput = {
  designation: '',
  name: '',
  streetAddress: '',
  postalCode: '',
  city: '',
}

/** Shared by "Lägg till fastighet" and the edit page. */
export function PropertyForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
  disabled = false,
  resetAfterSubmit = false,
  idPrefix = '',
  layout = 'wide',
}: {
  defaultValues: CreatePropertyInput
  submitLabel: string
  onSubmit: (value: CreatePropertyInput) => Promise<unknown>
  error: Error | null
  disabled?: boolean
  resetAfterSubmit?: boolean
  /** Keeps ids unique when the form can be on the page twice (card and phone drawer). */
  idPrefix?: string
  /** `narrow` stacks every field, for drawers. */
  layout?: 'wide' | 'narrow'
}) {
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
        <div className={layout === 'wide' ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-4'}>
          <form.Field name="designation">
            {(field) => (
              <TextField
                field={field}
                id={id('designation')}
                label="Fastighetsbeteckning"
                placeholder="Uppsala Kungsängen 12:3"
              />
            )}
          </form.Field>
          <form.Field name="name">
            {(field) => (
              <TextField
                field={field}
                id={id('name')}
                label={
                  <span>
                    Namn <span className="font-normal text-muted-foreground">(valfritt)</span>
                  </span>
                }
                placeholder="Kv. Lärkan"
              />
            )}
          </form.Field>
        </div>
        <form.Field name="streetAddress">
          {(field) => (
            <TextField
              field={field}
              id={id('streetAddress')}
              label="Gatuadress"
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
