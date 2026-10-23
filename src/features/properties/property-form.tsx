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
  resetAfterSubmit = false,
}: {
  defaultValues: CreatePropertyInput
  submitLabel: string
  onSubmit: (value: CreatePropertyInput) => Promise<unknown>
  error: Error | null
  resetAfterSubmit?: boolean
}) {
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
        void form.handleSubmit()
      }}
    >
      <form.Field name="designation">
        {(field) => (
          <TextField
            field={field}
            label="Fastighetsbeteckning"
            placeholder="Uppsala Kungsängen 12:3"
          />
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => <TextField field={field} label="Namn (valfritt)" placeholder="Kv. Lärkan" />}
      </form.Field>
      <form.Field name="streetAddress">
        {(field) => <TextField field={field} label="Gatuadress" />}
      </form.Field>
      <div className="grid grid-cols-[8rem_1fr] gap-4">
        <form.Field name="postalCode">
          {(field) => <TextField field={field} label="Postnummer" />}
        </form.Field>
        <form.Field name="city">{(field) => <TextField field={field} label="Ort" />}</form.Field>
      </div>
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
