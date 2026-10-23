import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { optionsFrom, SelectField } from '#/components/select-field'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { type TenantKind, tenantKindLabels } from '#/features/leases/options'
import { createTenantFn, tenantsQuery } from '#/features/tenants/functions'
import { CreateTenantInput } from '#/features/tenants/schemas'

export const Route = createFileRoute('/_app/tenants/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(tenantsQuery()),
  component: TenantsPage,
})

function TenantsPage() {
  const { data: tenants } = useSuspenseQuery(tenantsQuery())

  return (
    <div className="grid gap-8">
      <h1 className="font-semibold text-2xl">Hyresgäster</h1>
      {tenants.length === 0 ? (
        <p className="text-muted-foreground">Inga hyresgäster ännu.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Namn</th>
              <th className="py-2 font-medium">Typ</th>
              <th className="py-2 font-medium">Org.nr</th>
              <th className="py-2 font-medium">E-post</th>
              <th className="py-2 font-medium">Telefon</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b">
                <td className="py-2 font-medium">{t.name}</td>
                <td className="py-2">{tenantKindLabels[t.kind]}</td>
                <td className="py-2 tabular-nums">{t.organizationNumber}</td>
                <td className="py-2">{t.email}</td>
                <td className="py-2">{t.phone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CreateTenantForm />
    </div>
  )
}

const createTenantValidator = Schema.toStandardSchemaV1(CreateTenantInput)

function CreateTenantForm() {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createTenantFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantsQuery().queryKey }),
  })

  const form = useForm({
    defaultValues: {
      kind: 'company' as TenantKind,
      name: '',
      organizationNumber: '',
      email: '',
      phone: '',
      streetAddress: '',
      postalCode: '',
      city: '',
    },
    validators: { onSubmit: createTenantValidator },
    onSubmit: async ({ value, formApi }) => {
      await create.mutateAsync({ data: value })
      formApi.reset()
    },
  })

  return (
    <section className="grid max-w-xl gap-4 rounded-lg border p-6">
      <h2 className="font-medium text-lg">Lägg till hyresgäst</h2>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field name="kind">
          {(field) => (
            <SelectField field={field} label="Typ" options={optionsFrom(tenantKindLabels)} />
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.values.kind}>
          {(kind) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="name">
                {(field) => (
                  <TextField field={field} label={kind === 'company' ? 'Företagsnamn' : 'Namn'} />
                )}
              </form.Field>
              {kind === 'company' && (
                <form.Field name="organizationNumber">
                  {(field) => (
                    <TextField
                      field={field}
                      label="Organisationsnummer"
                      placeholder="556677-8899"
                    />
                  )}
                </form.Field>
              )}
            </div>
          )}
        </form.Subscribe>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="email">
            {(field) => <TextField field={field} label="E-post" type="email" />}
          </form.Field>
          <form.Field name="phone">
            {(field) => <TextField field={field} label="Telefon" type="tel" />}
          </form.Field>
        </div>
        <form.Field name="streetAddress">
          {(field) => <TextField field={field} label="Fakturaadress" />}
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
