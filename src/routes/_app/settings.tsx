import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Schema } from 'effect'
import { AlertTriangle, Check, CircleCheck, FileText, Lock } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Optional, useAppForm } from '#/components/form'
import { PageHeader } from '#/components/responsive'
import { SubmissionForm } from '#/components/submission-form'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { vatNumberFor } from '#/features/invoicing/rules'
import {
  type CompanyKind,
  companyKindLabels,
  companyKinds,
} from '#/features/settings/company-kinds'
import { settingsQuery, updateSettingsFn } from '#/features/settings/functions'
import { UpdateSettingsInput } from '#/features/settings/schemas'
import { sellerDetails, settingsReadiness } from '#/features/settings/seller'
import { isValidOrganizationNumber } from '#/features/tenants/organization-number'
import { useFormMutation } from '#/lib/form-mutation'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

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
  kind: s.kind as CompanyKind,
})
type Values = ReturnType<typeof toValues>

const sameValues = (a: Values, b: Values) =>
  (Object.keys(a) as (keyof Values)[]).every((k) => a[k] === b[k])

function SettingsPage() {
  const canEdit = useCan()({ settings: ['manage'] })
  const { data: settings } = useSuspenseQuery(settingsQuery())
  const queryClient = useQueryClient()
  const router = useRouter()
  const [baseline, setBaseline] = useState(() => toValues(settings))
  const [saved, setSaved] = useState(false)

  const save = useFormMutation({
    mutationFn: updateSettingsFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(settingsQuery().queryKey, updated)
      await queryClient.invalidateQueries({ queryKey: ['invoices'] }, { throwOnError: true })
      // The company type sets the navigation's wording, which comes from the route context.
      await router.invalidate()
    },
  })

  const form = useAppForm({
    defaultValues: baseline,
    validators: { onSubmit: validator },
    // Any edit hides the "Sparat" note from the previous save.
    listeners: { onChange: () => setSaved(false) },
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
        title={m.nav_settings()}
        subtitle={m.settings_subtitle({ organization: settings.organizationName })}
      />

      {!canEdit && (
        <p className="flex items-start gap-2.5 rounded-xl border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {m.settings_read_only()}
        </p>
      )}

      <form.Subscribe selector={(s) => s.values}>
        {(values) => <Readiness values={values} />}
      </form.Subscribe>

      <SubmissionForm form={form} disabled={!canEdit} method="post">
        <fieldset disabled={!canEdit} className="grid">
          <Section title={m.tenant_kind_company()} description={m.settings_company_description()}>
            <div className="grid gap-1.5">
              <span className="font-medium text-sm">{m.tenant_form_company_name()}</span>
              <span className="text-sm">{settings.organizationName}</span>
            </div>
            <div className="grid gap-1.5">
              <form.AppField name="kind">
                {(field) => (
                  <field.SegmentedField
                    label={m.settings_company_kind()}
                    showLabel
                    disabled={!canEdit}
                    options={companyKinds.map((kind) => ({
                      value: kind,
                      label: companyKindLabels[kind],
                    }))}
                  />
                )}
              </form.AppField>
              <p className="text-muted-foreground text-xs">{m.settings_company_kind_hint()}</p>
            </div>
            <form.AppField name="organizationNumber">
              {(field) => (
                <field.TextField
                  label={m.common_organization_number()}
                  placeholder={m.settings_org_number_placeholder()}
                  inputMode="numeric"
                  hint={
                    isValidOrganizationNumber(field.state.value) && (
                      <Note tone="ok">
                        {m.settings_vat_number({ number: vatNumberFor(field.state.value) })}
                      </Note>
                    )
                  }
                />
              )}
            </form.AppField>
            <div className="border-t pt-4">
              <form.AppField name="fSkatt">
                {(field) => (
                  <field.SwitchField
                    disabled={!canEdit}
                    label={m.settings_f_skatt()}
                    description={m.settings_f_skatt_description()}
                  />
                )}
              </form.AppField>
            </div>
          </Section>

          <Section title={m.settings_payment()} description={m.settings_payment_description()}>
            <form.AppField name="bankgiro">
              {(field) => (
                <field.TextField
                  label={m.settings_bankgiro()}
                  placeholder={m.settings_bankgiro_placeholder()}
                  inputMode="numeric"
                  hint={
                    !field.state.value.trim() && (
                      <Note tone="warn">{m.settings_bankgiro_required()}</Note>
                    )
                  }
                />
              )}
            </form.AppField>
          </Section>

          <Section title={m.settings_contact()} description={m.settings_contact_description()}>
            <form.AppField name="streetAddress">
              {(field) => (
                <field.TextField label={m.common_street_address()} autoComplete="street-address" />
              )}
            </form.AppField>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
              <form.AppField name="postalCode">
                {(field) => (
                  <field.TextField
                    label={m.common_postal_code()}
                    inputMode="numeric"
                    autoComplete="postal-code"
                  />
                )}
              </form.AppField>
              <form.AppField name="city">
                {(field) => (
                  <field.TextField label={m.common_city()} autoComplete="address-level2" />
                )}
              </form.AppField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="email">
                {(field) => (
                  <field.TextField
                    label={m.settings_email()}
                    type="email"
                    placeholder={m.settings_email_placeholder()}
                  />
                )}
              </form.AppField>
              <form.AppField name="phone">
                {(field) => (
                  <field.TextField label={<Optional>{m.common_phone()}</Optional>} type="tel" />
                )}
              </form.AppField>
            </div>
          </Section>

          <Section title={m.settings_preview()} description={m.settings_preview_description()}>
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
              dirty ? (
                <>
                  {/* Keeps the fixed bar from covering the last fields. */}
                  <div aria-hidden="true" className="h-28 sm:h-20" />
                  <section
                    aria-label={m.form_unsaved_label()}
                    className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 shadow-lg sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-auto sm:min-w-96"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">
                      <span aria-hidden="true" className="size-2 rounded-full bg-amber-500" />
                      {m.form_unsaved_label()}
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
                        {m.common_undo()}
                      </Button>
                      <Button
                        type="submit"
                        className="h-11 flex-1 sm:h-9 sm:flex-none"
                        disabled={submitting}
                      >
                        {m.common_save_changes()}
                      </Button>
                    </div>
                  </section>
                </>
              ) : (
                saved && (
                  <output className="mt-2 flex items-center gap-2 text-[13px] text-emerald-700 dark:text-emerald-300">
                    <Check aria-hidden="true" className="size-4" />
                    {m.settings_saved()}
                  </output>
                )
              )
            }
          </form.Subscribe>
        )}
      </SubmissionForm>
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
      aria-label={m.settings_readiness_label()}
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
            ? m.settings_ready()
            : m.settings_readiness_progress({ done, total: items.length })}
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
        <span className="text-muted-foreground">{m.settings_bankgiro()}</span>
        {values.bankgiro.trim() ? (
          <span className="font-medium tabular-nums">{values.bankgiro.trim()}</span>
        ) : (
          <span className="font-medium text-amber-700 dark:text-amber-300">
            {m.settings_missing()}
          </span>
        )}
      </div>
      <span className="text-muted-foreground text-xs">{m.settings_vat_footer_hint()}</span>
    </div>
  )
}
