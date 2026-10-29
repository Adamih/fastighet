import { useQueryClient } from '@tanstack/react-query'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'
import { invitePortalUserFn, portalAccessQuery } from './functions'

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

/** The email address to invite; the party's own address by default. */
export function InvitePortalUserForm({
  defaultEmail,
  onSubmit,
}: {
  defaultEmail: string
  onSubmit: (email: string) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues: { email: defaultEmail },
    onSubmit: ({ value }) => onSubmit(value.email.trim()),
  })
  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <fieldset className="grid gap-4">
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
              autoComplete="off"
              placeholder="namn@exempel.se"
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton>{m.portal_invite_send()}</form.SubmitButton>
        </form.AppForm>
      </fieldset>
    </SubmissionForm>
  )
}

/** "Bjud in" in the tenant page's Mina sidor panel. */
export function useInvitePortalUserDrawer(
  party: { id: string; name: string; email: string | null },
  onSent: (result: { email: string; emailed: boolean }) => void,
) {
  const queryClient = useQueryClient()
  const invite = useFormMutation({
    mutationFn: invitePortalUserFn,
    onSuccess: () =>
      queryClient.invalidateQueries(
        { queryKey: portalAccessQuery(party.id).queryKey },
        { throwOnError: true },
      ),
  })
  return useFormDrawer({
    title: m.portal_invite_title(),
    description: m.portal_invite_description({ name: party.name }),
    onClose: invite.reset,
    form: ({ close }) => (
      <InvitePortalUserForm
        defaultEmail={party.email ?? ''}
        onSubmit={async (email) => {
          const result = await invite.mutateAsync({ data: { partyId: party.id, email } })
          onSent({ email, emailed: result.emailed })
          close()
        }}
      />
    ),
  })
}
