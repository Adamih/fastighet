import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { getSessionFn } from '#/features/auth/functions'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage, safeRedirect } from '#/lib/auth-errors'
import { rich } from '#/lib/rich'
import { m } from '#/paraglide/messages'

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

  const form = useAppForm({
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
      if (result.error) return setError(authErrorMessage(result.error, m.login_failed()))
      await router.navigate({ href: next ?? '/' })
    },
  })

  if (verificationSentTo) {
    return (
      <main className="mx-auto grid max-w-sm gap-4 px-4 py-16">
        <h1 className="font-semibold text-2xl">{m.login_check_inbox()}</h1>
        <p>
          {rich(
            (email) => m.login_check_inbox_body({ email }),
            <span className="font-medium">{verificationSentTo}</span>,
          )}
        </p>
        <p className="text-muted-foreground text-sm">{m.login_check_inbox_hint()}</p>
        <button
          type="button"
          className="justify-self-start text-muted-foreground text-sm underline"
          onClick={() => {
            setVerificationSentTo(null)
            setMode('signIn')
          }}
        >
          {m.auth_back_to_login()}
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <h1 className="font-semibold text-2xl">
        {mode === 'signIn' ? m.login_sign_in() : m.login_sign_up()}
      </h1>
      <form
        method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        {mode === 'signUp' && (
          <form.AppField name="name">
            {(field) => <field.TextField label={m.common_name()} autoComplete="name" />}
          </form.AppField>
        )}
        <form.AppField name="email">
          {(field) => (
            <field.TextField label={m.common_email()} type="email" autoComplete="email" />
          )}
        </form.AppField>
        <form.AppField name="password">
          {(field) => (
            <field.TextField
              label={m.login_password()}
              type="password"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            />
          )}
        </form.AppField>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <form.AppForm>
          <form.SubmitButton className="sm:h-10 sm:w-full">
            {mode === 'signIn' ? m.login_sign_in() : m.login_sign_up()}
          </form.SubmitButton>
        </form.AppForm>
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
          {mode === 'signIn' ? m.login_switch_to_sign_up() : m.login_switch_to_sign_in()}
        </button>
        {mode === 'signIn' && (
          <Link to="/forgot-password" className="text-muted-foreground underline">
            {m.login_forgot_password()}
          </Link>
        )}
      </div>
    </main>
  )
}
