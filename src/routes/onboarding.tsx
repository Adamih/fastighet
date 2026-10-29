import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useRef } from 'react'
import { useAppForm } from '#/components/form'
import { SubmissionForm } from '#/components/submission-form'
import { getSessionFn } from '#/features/auth/functions'
import {
  type CompanyKind,
  companyKindLabels,
  companyKinds,
} from '#/features/settings/company-kinds'
import { setCompanyKindFn } from '#/features/settings/functions'
import { appError } from '#/lib/app-errors'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login' })
    // Mina sidor sessions never start a company; the login page says how to switch.
    if (session.workspace === 'portal') throw redirect({ to: '/login' })
    // Fastighet staff belong in the admin dashboard, even if they have a company membership.
    if (session.isAdmin) throw redirect({ to: '/admin' })
    if (session.hasOrganization) throw redirect({ to: '/' })
  },
  component: OnboardingPage,
})

const slugify = (name: string) =>
  `${name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${crypto.randomUUID().slice(0, 6)}`

function OnboardingPage() {
  const router = useRouter()
  const organizationId = useRef<string | null>(null)

  const form = useAppForm({
    defaultValues: { name: '', kind: 'landlord' as CompanyKind },
    onSubmit: async ({ value }) => {
      if (!organizationId.current) {
        const created = await authClient.organization.create({
          name: value.name.trim(),
          slug: slugify(value.name),
        })
        if (created.error)
          throw appError('validation', authErrorMessage(created.error, m.onboarding_failed()))
        organizationId.current = created.data.id
      }
      const active = await authClient.organization.setActive({
        organizationId: organizationId.current,
      })
      if (active.error) throw appError('validation', authErrorMessage(active.error))
      // Retrying after a failure here is safe: setting the type again changes nothing.
      await setCompanyKindFn({ data: { kind: value.kind } })
      await router.navigate({ to: '/' })
    },
  })

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl">{m.onboarding_title()}</h1>
        <p className="text-muted-foreground text-sm">{m.onboarding_intro()}</p>
      </div>
      <SubmissionForm form={form} method="post" className="grid gap-4">
        <form.AppField
          name="name"
          validators={{
            onSubmit: ({ value }) => (value.trim() ? undefined : m.common_name_required()),
          }}
        >
          {(field) => (
            <field.TextField
              label={m.tenant_form_company_name()}
              placeholder="Exempel Fastigheter AB"
            />
          )}
        </form.AppField>

        <form.AppField name="kind">
          {(field) => (
            <field.SegmentedField
              label={m.onboarding_company_kind()}
              showLabel
              options={companyKinds.map((kind) => ({
                value: kind,
                label: companyKindLabels[kind],
              }))}
            />
          )}
        </form.AppField>

        <form.AppForm>
          <form.SubmitButton className="sm:h-10 sm:w-full">
            {m.onboarding_submit()}
          </form.SubmitButton>
        </form.AppForm>
      </SubmissionForm>
    </main>
  )
}
