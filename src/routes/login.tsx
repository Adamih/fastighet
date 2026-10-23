import { useForm } from '@tanstack/react-form'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { getSessionFn } from '#/features/auth/functions'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await getSessionFn()) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value }) => {
      setError(null)
      const result =
        mode === 'signIn'
          ? await authClient.signIn.email({ email: value.email, password: value.password })
          : await authClient.signUp.email(value)
      if (result.error) {
        setError(result.error.message ?? 'Inloggningen misslyckades')
        return
      }
      await router.navigate({ to: '/' })
    },
  })

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <h1 className="font-semibold text-2xl">{mode === 'signIn' ? 'Logga in' : 'Skapa konto'}</h1>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        {mode === 'signUp' && (
          <form.Field name="name">
            {(field) => <TextField field={field} label="Namn" autoComplete="name" />}
          </form.Field>
        )}
        <form.Field name="email">
          {(field) => <TextField field={field} label="E-post" type="email" autoComplete="email" />}
        </form.Field>
        <form.Field name="password">
          {(field) => (
            <TextField
              field={field}
              label="Lösenord"
              type="password"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            />
          )}
        </form.Field>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {mode === 'signIn' ? 'Logga in' : 'Skapa konto'}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <button
        type="button"
        className="text-muted-foreground text-sm underline"
        onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
      >
        {mode === 'signIn' ? 'Inget konto? Skapa ett' : 'Har du redan ett konto? Logga in'}
      </button>
    </main>
  )
}
