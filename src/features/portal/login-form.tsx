import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { SubmissionForm } from '#/components/submission-form'
import { Button } from '#/components/ui/button'
import { appError } from '#/lib/app-errors'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { portalDestination } from '#/lib/auth-navigation'
import { m } from '#/paraglide/messages'

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

/**
 * Signing in to Mina sidor: an email address, then the code sent to it. The server only sends
 * codes to people with portal access and answers everyone else the same way.
 */
export function PortalLoginForm({ redirectTo }: { redirectTo?: string }) {
  const [email, setEmail] = useState<string | null>(null)
  return email === null ? (
    <EmailStep onSent={setEmail} />
  ) : (
    <CodeStep email={email} redirectTo={redirectTo} onBack={() => setEmail(null)} />
  )
}

const sendCode = async (email: string) => {
  const sent = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
  if (sent.error) throw appError('validation', authErrorMessage(sent.error))
}

function EmailStep({ onSent }: { onSent: (email: string) => void }) {
  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      const email = value.email.trim().toLowerCase()
      await sendCode(email)
      onSent(email)
    },
  })
  return (
    <SubmissionForm form={form} method="post" className="grid gap-4">
      <form.AppField
        name="email"
        validators={{
          onSubmit: ({ value }) =>
            validEmail(value) ? undefined : m.portal_invite_email_invalid(),
        }}
      >
        {(field) => (
          <field.TextField
            label={m.portal_invite_email()}
            type="email"
            autoComplete="email"
            placeholder="namn@exempel.se"
          />
        )}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton className="sm:h-10 sm:w-full">
          {m.portal_login_send_code()}
        </form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

function CodeStep({
  email,
  redirectTo,
  onBack,
}: {
  email: string
  redirectTo?: string
  onBack: () => void
}) {
  const router = useRouter()
  const [resent, setResent] = useState(false)
  const form = useAppForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      const signedIn = await authClient.signIn.emailOtp({ email, otp: value.code.trim() })
      if (signedIn.error) {
        throw appError(
          'validation',
          authErrorMessage(signedIn.error, m.portal_login_code_invalid()),
        )
      }
      await router.invalidate()
      await router.navigate({ href: portalDestination(redirectTo) })
    },
  })
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">{m.portal_login_code_sent({ email })}</p>
      <SubmissionForm form={form} method="post" className="grid gap-4">
        <form.AppField
          name="code"
          validators={{
            onSubmit: ({ value }) =>
              /^\d{6}$/.test(value.trim()) ? undefined : m.portal_login_code_format(),
          }}
        >
          {(field) => (
            <field.TextField
              label={m.portal_login_code()}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton className="sm:h-10 sm:w-full">
            {m.portal_login_submit()}
          </form.SubmitButton>
        </form.AppForm>
      </SubmissionForm>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Button variant="link" className="h-11 px-0 sm:h-auto" onClick={onBack}>
          {m.portal_login_change_email()}
        </Button>
        <Button
          variant="link"
          className="h-11 px-0 sm:h-auto"
          onClick={async () => {
            await sendCode(email)
            setResent(true)
          }}
        >
          {resent ? m.portal_login_code_resent() : m.portal_login_resend()}
        </Button>
      </div>
    </div>
  )
}
