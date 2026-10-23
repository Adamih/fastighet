import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { useState } from 'react'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { useCan } from '#/features/auth/use-can'
import { settingsQuery, updateSettingsFn } from '#/features/settings/functions'
import { UpdateSettingsInput } from '#/features/settings/schemas'

export const Route = createFileRoute('/_app/settings')({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery()),
  component: SettingsPage,
})

const validator = Schema.toStandardSchemaV1(UpdateSettingsInput)

function SettingsPage() {
  const canManage = useCan()({ settings: ['manage'] })
  const { data: settings } = useSuspenseQuery(settingsQuery())
  const canEdit = canManage
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: updateSettingsFn,
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsQuery().queryKey, updated)
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      setSaved(true)
    },
  })

  const form = useForm({
    defaultValues: {
      organizationNumber: settings.organizationNumber ?? '',
      bankgiro: settings.bankgiro ?? '',
      streetAddress: settings.streetAddress ?? '',
      postalCode: settings.postalCode ?? '',
      city: settings.city ?? '',
      email: settings.email ?? '',
      phone: settings.phone ?? '',
      fSkatt: settings.fSkatt,
    },
    validators: { onSubmit: validator },
    onSubmit: async ({ value }) => {
      setSaved(false)
      await save.mutateAsync({ data: value })
    },
  })

  return (
    <div className="grid max-w-2xl gap-6">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl">Inställningar</h1>
        <p className="text-muted-foreground">
          Uppgifterna skrivs ut på hyresavierna för {settings.organizationName}.
          {!canEdit && ' Bara ägare och administratörer kan ändra dem.'}
        </p>
      </div>
      <form
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <fieldset disabled={!canEdit} className="grid gap-4">
          <section className="grid gap-4">
            <h2 className="font-medium">Betalning</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="bankgiro">
                {(field) => <TextField field={field} label="Bankgiro" placeholder="5050-1055" />}
              </form.Field>
              <form.Field name="organizationNumber">
                {(field) => (
                  <TextField field={field} label="Organisationsnummer" placeholder="556677-8899" />
                )}
              </form.Field>
            </div>
            <form.Field name="fSkatt">
              {(field) => (
                <div className="flex items-center gap-3">
                  <Switch
                    id={field.name}
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                  <Label htmlFor={field.name}>Godkänd för F-skatt</Label>
                </div>
              )}
            </form.Field>
          </section>
          <section className="grid gap-4">
            <h2 className="font-medium">Adress och kontakt</h2>
            <form.Field name="streetAddress">
              {(field) => <TextField field={field} label="Gatuadress" />}
            </form.Field>
            <div className="grid grid-cols-[8rem_1fr] gap-4">
              <form.Field name="postalCode">
                {(field) => <TextField field={field} label="Postnummer" />}
              </form.Field>
              <form.Field name="city">
                {(field) => <TextField field={field} label="Ort" />}
              </form.Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="email">
                {(field) => <TextField field={field} label="E-post för frågor" type="email" />}
              </form.Field>
              <form.Field name="phone">
                {(field) => <TextField field={field} label="Telefon" type="tel" />}
              </form.Field>
            </div>
          </section>
        </fieldset>
        {save.error && <p className="text-destructive text-sm">{save.error.message}</p>}
        {saved && <p className="text-emerald-700 text-sm dark:text-emerald-300">Sparat.</p>}
        {canEdit && (
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting} className="justify-self-start">
                Spara
              </Button>
            )}
          </form.Subscribe>
        )}
      </form>
    </div>
  )
}
