import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { getSessionFn } from '#/features/auth/functions'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login' })
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
  const [error, setError] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      setError(null)
      const created = await authClient.organization.create({
        name: value.name.trim(),
        slug: slugify(value.name),
      })
      if (created.error) {
        setError(created.error.message ?? m.onboarding_failed())
        return
      }
      await authClient.organization.setActive({ organizationId: created.data.id })
      await router.navigate({ to: '/' })
    },
  })

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl">{m.onboarding_title()}</h1>
        <p className="text-muted-foreground text-sm">{m.onboarding_intro()}</p>
      </div>
      <form
        method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
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
        {error && <p className="text-destructive text-sm">{error}</p>}
        <form.AppForm>
          <form.SubmitButton className="sm:h-10 sm:w-full">
            {m.onboarding_submit()}
          </form.SubmitButton>
        </form.AppForm>
      </form>
    </main>
  )
}
