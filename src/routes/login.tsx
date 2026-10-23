import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { getSessionFn } from '#/features/auth/functions'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage, safeRedirect } from '#/lib/auth-errors'

export const Route = createFileRoute('/login')({
  validateSearch: (search): { redirect?: string } => ({ redirect: safeRedirect(search.redirect) }),
  beforeLoad: async ({ search }) => {
    if (await getSessionFn()) throw redirect({ href: search.redirect ?? '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const { redirect: next } = Route.useSearch()
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [error, setError] = useState<string | null>(null)
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value }) => {
      setError(null)
      // Where the verification link lands after confirming (and signing in).
      const callbackURL = next ?? '/'
      if (mode === 'signUp') {
        const result = await authClient.signUp.email({ ...value, callbackURL })
        if (result.error) return setError(authErrorMessage(result.error))
        setVerificationSentTo(value.email)
        return
      }
      const result = await authClient.signIn.email({
        email: value.email,
        password: value.password,
        callbackURL,
      })
      if (result.error) return setError(authErrorMessage(result.error, 'Inloggningen misslyckades'))
      await router.navigate({ href: next ?? '/' })
    },
  })

  if (verificationSentTo) {
    return (
      <main className="mx-auto grid max-w-sm gap-4 px-4 py-16">
        <h1 className="font-semibold text-2xl">Kolla din inkorg</h1>
        <p>
          Vi har skickat en länk till <span className="font-medium">{verificationSentTo}</span>.
          Klicka på den för att bekräfta din e-postadress och logga in.
        </p>
        <p className="text-muted-foreground text-sm">
          Inget mejl? Kolla skräpposten, eller försök logga in så skickar vi en ny länk.
        </p>
        <button
          type="button"
          className="justify-self-start text-muted-foreground text-sm underline"
          onClick={() => {
            setVerificationSentTo(null)
            setMode('signIn')
          }}
        >
          Tillbaka till inloggningen
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <h1 className="font-semibold text-2xl">{mode === 'signIn' ? 'Logga in' : 'Skapa konto'}</h1>
      <form
        method="post"
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
      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="text-muted-foreground underline"
          onClick={() => {
            setError(null)
            setMode(mode === 'signIn' ? 'signUp' : 'signIn')
          }}
        >
          {mode === 'signIn' ? 'Inget konto? Skapa ett' : 'Har du redan ett konto? Logga in'}
        </button>
        {mode === 'signIn' && (
          <Link to="/forgot-password" className="text-muted-foreground underline">
            Glömt lösenordet?
          </Link>
        )}
      </div>
    </main>
  )
}
