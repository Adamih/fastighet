import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { SubmissionForm } from '#/components/submission-form'
import { appError } from '#/lib/app-errors'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { m } from '#/paraglide/messages'

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

  const form = useAppForm({
    defaultValues: { password: '', confirm: '' },
    onSubmit: async ({ value }) => {
      if (!token) return
      const result = await authClient.resetPassword({ newPassword: value.password, token })
      if (result.error) throw appError('validation', authErrorMessage(result.error))
      setDone(true)
    },
  })

  if (linkError || !token) {
    return (
      <main className="mx-auto grid max-w-sm gap-4 px-4 py-16">
        <h1 className="font-semibold text-2xl">{m.reset_link_broken()}</h1>
        <p>{m.auth_error_invalid_token()}</p>
        <Link to="/forgot-password" className="underline">
          {m.reset_send_new_link()}
        </Link>
      </main>
    )
  }

  if (done) {
    return (
      <main className="mx-auto grid max-w-sm gap-4 px-4 py-16">
        <h1 className="font-semibold text-2xl">{m.reset_done()}</h1>
        <p>{m.reset_done_body()}</p>
        <Link to="/login" className="underline">
          {m.login_sign_in()}
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <h1 className="font-semibold text-2xl">{m.reset_title()}</h1>
      <SubmissionForm form={form} method="post" className="grid gap-4">
        <form.AppField
          name="password"
          validators={{
            onSubmit: ({ value }) =>
              value.length >= 8 ? undefined : m.auth_error_password_too_short(),
          }}
        >
          {(field) => (
            <field.TextField
              label={m.reset_new_password()}
              type="password"
              autoComplete="new-password"
            />
          )}
        </form.AppField>
        <form.AppField
          name="confirm"
          validators={{
            onSubmit: ({ value, fieldApi }) =>
              value === fieldApi.form.getFieldValue('password') ? undefined : m.reset_mismatch(),
          }}
        >
          {(field) => (
            <field.TextField
              label={m.reset_repeat_password()}
              type="password"
              autoComplete="new-password"
            />
          )}
        </form.AppField>

        <form.AppForm>
          <form.SubmitButton className="sm:h-10 sm:w-full">{m.reset_submit()}</form.SubmitButton>
        </form.AppForm>
      </SubmissionForm>
    </main>
  )
}
