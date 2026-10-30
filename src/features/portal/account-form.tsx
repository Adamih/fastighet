import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { SubmissionForm } from '#/components/submission-form'
import { appError } from '#/lib/app-errors'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { m } from '#/paraglide/messages'

/**
 * The person's own name on their account (Better Auth's user), under Kontoinställningar: the
 * portal's greeting and who the company's log says made a change. Not a party's name.
 */
export function PortalAccountNameForm({ name }: { name: string }) {
  const router = useRouter()
  const [saved, setSaved] = useState(false)
  const form = useAppForm({
    defaultValues: { name },
    listeners: { onChange: () => setSaved(false) },
    onSubmit: async ({ value }) => {
      const updated = await authClient.updateUser({ name: value.name.trim() })
      if (updated.error) throw appError('validation', authErrorMessage(updated.error))
      // The layout's context carries the name (the greeting).
      await router.invalidate()
      setSaved(true)
    },
  })
  return (
    <SubmissionForm form={form} method="post" className="grid gap-4">
      <form.AppField
        name="name"
        validators={{
          onSubmit: ({ value }) => (value.trim() ? undefined : m.common_name_required()),
        }}
      >
        {(field) => (
          <field.TextField
            label={m.portal_account_name()}
            autoComplete="name"
            hint={m.portal_account_name_hint()}
          />
        )}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton className="sm:w-auto sm:justify-self-start">
          {m.portal_contact_save()}
        </form.SubmitButton>
      </form.AppForm>
      {saved && (
        <p className="text-emerald-700 text-sm dark:text-emerald-300">{m.portal_account_saved()}</p>
      )}
    </SubmissionForm>
  )
}
