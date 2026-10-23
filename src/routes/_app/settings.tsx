import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { AlertTriangle, Check, CircleCheck, FileText, Lock } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { PageHeader } from '#/components/responsive'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { useCan } from '#/features/auth/use-can'
import { vatNumberFor } from '#/features/invoicing/rules'
import { settingsQuery, updateSettingsFn } from '#/features/settings/functions'
import { UpdateSettingsInput } from '#/features/settings/schemas'
import { sellerDetails, settingsReadiness } from '#/features/settings/seller'
import { isValidOrganizationNumber } from '#/features/tenants/organization-number'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_app/settings')({
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery()),
  component: SettingsPage,
})

const validator = Schema.toStandardSchemaV1(UpdateSettingsInput)

type Settings = typeof Route.types.loaderData

const toValues = (s: Settings) => ({
  organizationNumber: s.organizationNumber ?? '',
  bankgiro: s.bankgiro ?? '',
  streetAddress: s.streetAddress ?? '',
  postalCode: s.postalCode ?? '',
  city: s.city ?? '',
  email: s.email ?? '',
  phone: s.phone ?? '',
  fSkatt: s.fSkatt,
})
type Values = ReturnType<typeof toValues>

const sameValues = (a: Values, b: Values) =>
  (Object.keys(a) as (keyof Values)[]).every((k) => a[k] === b[k])

function SettingsPage() {
  const canEdit = useCan()({ settings: ['manage'] })
  const { data: settings } = useSuspenseQuery(settingsQuery())
  const queryClient = useQueryClient()
  const [baseline, setBaseline] = useState(() => toValues(settings))
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: updateSettingsFn,
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsQuery().queryKey, updated)
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })

  const form = useForm({
    defaultValues: baseline,
    validators: { onSubmit: validator },
    onSubmit: async ({ value, formApi }) => {
      const updated = await save.mutateAsync({ data: value })
      // The server normalises (e.g. "5050 1055" → "5050-1055"); start over from what it stored.
      const next = toValues(updated)
      setBaseline(next)
      formApi.reset(next)
      setSaved(true)
    },
  })

  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader
        title="Inställningar"
        subtitle={`${settings.organizationName} · uppgifterna skrivs ut på varje hyresavi`}
      />

      {!canEdit && (
        <p className="flex items-start gap-2.5 rounded-xl border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Du kan se uppgifterna men inte ändra dem. Ägare och administratörer kan ändra.
        </p>
      )}

      <form.Subscribe selector={(s) => s.values}>
        {(values) => <Readiness values={values} />}
      </form.Subscribe>

      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault()
          if (canEdit) void form.handleSubmit()
        }}
        onChange={() => setSaved(false)}
      >
        <fieldset disabled={!canEdit} className="grid">
          <Section title="Företag" description="Säljaruppgifter som måste stå på en faktura.">
            <div className="grid gap-1.5">
              <span className="font-medium text-sm">Företagsnamn</span>
              <span className="text-sm">{settings.organizationName}</span>
            </div>
            <form.Field name="organizationNumber">
              {(field) => (
                <div className="grid gap-1.5">
                  <TextField
                    field={field}
                    label="Organisationsnummer"
                    placeholder="556677-8899"
                    inputMode="numeric"
                  />
                  {isValidOrganizationNumber(field.state.value) && (
                    <Note tone="ok">Momsreg.nr {vatNumberFor(field.state.value)}</Note>
                  )}
                </div>
              )}
            </form.Field>
            <form.Field name="fSkatt">
              {(field) => (
                <div className="flex items-center justify-between gap-4 border-t pt-4">
                  <div className="grid gap-0.5">
                    <Label htmlFor={field.name}>Godkänd för F-skatt</Label>
                    <span className="text-muted-foreground text-xs">
                      Skrivs ut som ”Godkänd för F-skatt” på avin.
                    </span>
                  </div>
                  <Switch
                    id={field.name}
                    disabled={!canEdit}
                    checked={field.state.value}
                    onCheckedChange={(checked) => {
                      field.handleChange(checked)
                      setSaved(false)
                    }}
                  />
                </div>
              )}
            </form.Field>
          </Section>

          <Section
            title="Betalning"
            description="Vart hyran betalas. OCR-numret byggs av avins nummer."
          >
            <form.Field name="bankgiro">
              {(field) => (
                <div className="grid gap-1.5">
                  <TextField
                    field={field}
                    label="Bankgiro"
                    placeholder="5050-1055"
                    inputMode="numeric"
                  />
                  {!field.state.value.trim() && (
                    <Note tone="warn">Krävs för att avier ska kunna betalas</Note>
                  )}
                </div>
              )}
            </form.Field>
          </Section>

          <Section
            title="Adress och kontakt"
            description="Visas i avins sidfot så att hyresgäster vet vem de ska fråga."
          >
            <form.Field name="streetAddress">
              {(field) => (
                <TextField field={field} label="Gatuadress" autoComplete="street-address" />
              )}
            </form.Field>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
              <form.Field name="postalCode">
                {(field) => (
                  <TextField
                    field={field}
                    label="Postnummer"
                    inputMode="numeric"
                    autoComplete="postal-code"
                  />
                )}
              </form.Field>
              <form.Field name="city">
                {(field) => <TextField field={field} label="Ort" autoComplete="address-level2" />}
              </form.Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="email">
                {(field) => (
                  <TextField
                    field={field}
                    label="E-post för frågor"
                    type="email"
                    placeholder="hyra@foretag.se"
                  />
                )}
              </form.Field>
              <form.Field name="phone">
                {(field) => (
                  <TextField
                    field={field}
                    label={
                      <span>
                        Telefon{' '}
                        <span className="font-normal text-muted-foreground">(valfritt)</span>
                      </span>
                    }
                    type="tel"
                  />
                )}
              </form.Field>
            </div>
          </Section>

          <Section title="Förhandsvisning" description="Så här ser sidfoten ut på nästa avi.">
            <form.Subscribe selector={(s) => s.values}>
              {(values) => <FooterPreview name={settings.organizationName} values={values} />}
            </form.Subscribe>
          </Section>
        </fieldset>

        {canEdit && (
          <form.Subscribe
            selector={(s) => ({
              dirty: !sameValues(s.values, baseline),
              submitting: s.isSubmitting,
            })}
          >
            {({ dirty, submitting }) =>
              dirty || save.error ? (
                <>
                  {/* Keeps the fixed bar from covering the last fields. */}
                  <div aria-hidden="true" className="h-28 sm:h-20" />
                  <section
                    aria-label="Osparade ändringar"
                    className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 shadow-lg sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-auto sm:min-w-96"
                  >
                    <span
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 text-[13px]',
                        save.error ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {save.error ? (
                        save.error.message
                      ) : (
                        <>
                          <span aria-hidden="true" className="size-2 rounded-full bg-amber-500" />
                          Osparade ändringar
                        </>
                      )}
                    </span>
                    <div className="flex w-full gap-2 sm:w-auto">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 flex-1 sm:h-9 sm:flex-none"
                        disabled={submitting}
                        onClick={() => {
                          form.reset(baseline)
                          save.reset()
                        }}
                      >
                        Ångra
                      </Button>
                      <Button
                        type="submit"
                        className="h-11 flex-1 sm:h-9 sm:flex-none"
                        disabled={submitting}
                      >
                        Spara ändringar
                      </Button>
                    </div>
                  </section>
                </>
              ) : (
                saved && (
                  <output className="mt-2 flex items-center gap-2 text-[13px] text-emerald-700 dark:text-emerald-300">
                    <Check aria-hidden="true" className="size-4" />
                    Sparat. Nya avier får de nya uppgifterna.
                  </output>
                )
              )
            }
          </form.Subscribe>
        )}
      </form>
    </div>
  )
}

/** A titled group: explanation on the left from `md` up, fields in a card on the right. */
function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-3 border-t py-6 first:border-t-0 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
      <div className="grid content-start gap-1">
        <h2 className="font-semibold text-[15px]">{title}</h2>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
      <div className="grid gap-4 rounded-xl border bg-card p-4 md:p-5">{children}</div>
    </section>
  )
}

function Note({ tone, children }: { tone: 'ok' | 'warn'; children: ReactNode }) {
  const Icon = tone === 'ok' ? Check : AlertTriangle
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs',
        tone === 'ok'
          ? 'text-emerald-700 dark:text-emerald-300'
          : 'text-amber-700 dark:text-amber-300',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </span>
  )
}

/** How many of the details invoices need are filled in, and the most important one missing. */
function Readiness({ values }: { values: Values }) {
  const items = settingsReadiness(values)
  const done = items.filter((i) => i.done).length
  const firstMissing = items.find((i) => !i.done)
  const ready = !firstMissing
  return (
    <section
      aria-label="Uppgifter för avier"
      className={cn(
        'flex items-center gap-3.5 rounded-xl border px-4 py-3',
        ready
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
          : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
      )}
    >
      {ready ? (
        <CircleCheck aria-hidden="true" className="size-5 shrink-0" />
      ) : (
        <FileText aria-hidden="true" className="size-5 shrink-0" />
      )}
      <div className="grid min-w-0 flex-1 gap-0.5 text-[13px]">
        <span className="font-semibold">
          {ready
            ? 'Avierna har alla uppgifter de behöver'
            : `${done} av ${items.length} uppgifter för avier är klara`}
        </span>
        {firstMissing && <span>{firstMissing.missing}</span>}
      </div>
      <div aria-hidden="true" className="hidden gap-1 sm:flex">
        {items.map((i) => (
          <span
            key={i.key}
            className={cn('h-1.5 w-5 rounded-full', i.done ? 'bg-current' : 'bg-current/20')}
          />
        ))}
      </div>
    </section>
  )
}

/** The seller lines exactly as invoices print them, plus the bankgiro from the payment box. */
function FooterPreview({ name, values }: { name: string; values: Values }) {
  const trimmed = (v: string) => v.trim() || null
  const lines = sellerDetails(
    {
      organizationName: name,
      organizationNumber: isValidOrganizationNumber(values.organizationNumber)
        ? values.organizationNumber.trim()
        : null,
      streetAddress: trimmed(values.streetAddress),
      postalCode: trimmed(values.postalCode),
      city: trimmed(values.city),
      email: trimmed(values.email),
      phone: trimmed(values.phone),
      fSkatt: values.fSkatt,
    },
    true,
  )
  return (
    <div className="grid gap-3 rounded-lg border border-dashed bg-muted/30 p-4 text-[13px]">
      <div className="grid gap-0.5 text-muted-foreground leading-relaxed">
        {lines.map((line, i) => (
          <span key={line} className={cn(i === 0 && 'font-medium text-foreground')}>
            {line}
          </span>
        ))}
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-dashed pt-3">
        <span className="text-muted-foreground">Bankgiro</span>
        {values.bankgiro.trim() ? (
          <span className="font-medium tabular-nums">{values.bankgiro.trim()}</span>
        ) : (
          <span className="font-medium text-amber-700 dark:text-amber-300">saknas</span>
        )}
      </div>
      <span className="text-muted-foreground text-xs">
        Momsreg.nr skrivs bara ut på avier med moms.
      </span>
    </div>
  )
}
