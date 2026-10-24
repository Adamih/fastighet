import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'

// Better Auth's emailed link checks the token and redirects here with ?token=… (or ?error=…).
export const Route = createFileRoute('/reset-password')({
  validateSearch: (search): { token?: string; error?: string } => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token, error: linkError } = Route.useSearch()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: { password: '', confirm: '' },
    onSubmit: async ({ value }) => {
      if (!token) return
      setError(null)
      const result = await authClient.resetPassword({ newPassword: value.password, token })
      if (result.error) return setError(authErrorMessage(result.error))
      setDone(true)
    },
  })

  if (linkError || !token) {
    return (
      <main className="mx-auto grid max-w-sm gap-4 px-4 py-16">
        <h1 className="font-semibold text-2xl">Länken fungerar inte</h1>
        <p>Länken är ogiltig eller har gått ut.</p>
        <Link to="/forgot-password" className="underline">
          Skicka en ny länk
        </Link>
      </main>
    )
  }

  if (done) {
    return (
      <main className="mx-auto grid max-w-sm gap-4 px-4 py-16">
        <h1 className="font-semibold text-2xl">Lösenordet är bytt</h1>
        <p>Du har loggats ut överallt. Logga in med ditt nya lösenord.</p>
        <Link to="/login" className="underline">
          Logga in
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <h1 className="font-semibold text-2xl">Välj nytt lösenord</h1>
      <form
        method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.AppField
          name="password"
          validators={{
            onSubmit: ({ value }) =>
              value.length >= 8 ? undefined : 'Lösenordet måste vara minst 8 tecken',
          }}
        >
          {(field) => (
            <field.TextField label="Nytt lösenord" type="password" autoComplete="new-password" />
          )}
        </form.AppField>
        <form.AppField
          name="confirm"
          validators={{
            onSubmit: ({ value, fieldApi }) =>
              value === fieldApi.form.getFieldValue('password')
                ? undefined
                : 'Lösenorden matchar inte',
          }}
        >
          {(field) => (
            <field.TextField
              label="Upprepa lösenordet"
              type="password"
              autoComplete="new-password"
            />
          )}
        </form.AppField>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <form.AppForm>
          <form.SubmitButton className="sm:h-10 sm:w-full">Spara lösenord</form.SubmitButton>
        </form.AppForm>
      </form>
    </main>
  )
}
