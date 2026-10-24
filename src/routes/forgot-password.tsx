import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { SubmissionForm } from '#/components/submission-form'
import { appError } from '#/lib/app-errors'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { rich } from '#/lib/rich'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage })

function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      const result = await authClient.requestPasswordReset({
        email: value.email,
        redirectTo: '/reset-password',
      })
      if (result.error) throw appError('validation', authErrorMessage(result.error))
      setSentTo(value.email)
    },
  })

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <h1 className="font-semibold text-2xl">{m.forgot_title()}</h1>
      {sentTo ? (
        // Same answer whether or not the account exists, so the page cannot be used to probe.
        <p>
          {rich((email) => m.forgot_sent({ email }), <span className="font-medium">{sentTo}</span>)}
        </p>
      ) : (
        <SubmissionForm form={form} method="post" className="grid gap-4">
          <p className="text-muted-foreground text-sm">{m.forgot_intro()}</p>
          <form.AppField
            name="email"
            validators={{
              onSubmit: ({ value }) =>
                value.includes('@') ? undefined : m.forgot_email_required(),
            }}
          >
            {(field) => (
              <field.TextField label={m.common_email()} type="email" autoComplete="email" />
            )}
          </form.AppField>

          <form.AppForm>
            <form.SubmitButton className="sm:h-10 sm:w-full">{m.forgot_submit()}</form.SubmitButton>
          </form.AppForm>
        </SubmissionForm>
      )}
      <Link to="/login" className="text-muted-foreground text-sm underline">
        {m.auth_back_to_login()}
      </Link>
    </main>
  )
}
