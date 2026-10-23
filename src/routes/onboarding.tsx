import { useForm } from '@tanstack/react-form'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { getSessionFn } from '#/features/auth/functions'
import { authClient } from '#/lib/auth-client'

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

  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      setError(null)
      const created = await authClient.organization.create({
        name: value.name.trim(),
        slug: slugify(value.name),
      })
      if (created.error) {
        setError(created.error.message ?? 'Kunde inte skapa företaget')
        return
      }
      await authClient.organization.setActive({ organizationId: created.data.id })
      await router.navigate({ to: '/' })
    },
  })

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl">Skapa ditt företag</h1>
        <p className="text-muted-foreground text-sm">
          Fastigheter, objekt och användare hör till ett företag. Du kan bjuda in kollegor senare.
        </p>
      </div>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field
          name="name"
          validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'Ange ett namn') }}
        >
          {(field) => (
            <TextField field={field} label="Företagsnamn" placeholder="Exempel Fastigheter AB" />
          )}
        </form.Field>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              Fortsätt
            </Button>
          )}
        </form.Subscribe>
      </form>
    </main>
  )
}
