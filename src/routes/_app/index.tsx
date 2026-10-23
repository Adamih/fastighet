import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Schema } from 'effect'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { createPropertyFn, propertiesQuery } from '#/features/properties/functions'
import { CreatePropertyInput } from '#/features/properties/schemas'

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(propertiesQuery()),
  component: PropertiesPage,
})

function PropertiesPage() {
  const { data: properties } = useSuspenseQuery(propertiesQuery())

  return (
    <div className="grid gap-8">
      <h1 className="font-semibold text-2xl">Fastigheter</h1>
      {properties.length === 0 ? (
        <p className="text-muted-foreground">Inga fastigheter ännu. Lägg till den första nedan.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Beteckning</th>
              <th className="py-2 font-medium">Namn</th>
              <th className="py-2 font-medium">Adress</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">
                  <Link
                    to="/properties/$propertyId"
                    params={{ propertyId: p.id }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.designation}
                  </Link>
                </td>
                <td className="py-2">{p.name}</td>
                <td className="py-2">
                  {[p.streetAddress, [p.postalCode, p.city].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CreatePropertyForm />
    </div>
  )
}

const createPropertyValidator = Schema.toStandardSchemaV1(CreatePropertyInput)

function CreatePropertyForm() {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: (data: CreatePropertyInput) => createPropertyFn({ data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: propertiesQuery().queryKey }),
  })

  const form = useForm({
    defaultValues: { designation: '', name: '', streetAddress: '', postalCode: '', city: '' },
    validators: { onSubmit: createPropertyValidator },
    onSubmit: async ({ value, formApi }) => {
      await create.mutateAsync(value)
      formApi.reset()
    },
  })

  return (
    <section className="grid max-w-xl gap-4 rounded-lg border p-6">
      <h2 className="font-medium text-lg">Lägg till fastighet</h2>
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
        {create.error && <p className="text-destructive text-sm">{create.error.message}</p>}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting} className="justify-self-start">
              Spara
            </Button>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
