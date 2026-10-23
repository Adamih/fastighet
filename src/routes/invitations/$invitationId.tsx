import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { getInvitationFn, getSessionFn } from '#/features/auth/functions'
import { roleLabels } from '#/features/team/roles'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'

// The link in the invitation email. Signed-out visitors sign in or create an account first
// (with the invited address) and come back here.
export const Route = createFileRoute('/invitations/$invitationId')({
  beforeLoad: async ({ params }) => {
    if (!(await getSessionFn())) {
      throw redirect({ to: '/login', search: { redirect: `/invitations/${params.invitationId}` } })
    }
  },
  loader: ({ params }) => getInvitationFn({ data: { invitationId: params.invitationId } }),
  component: InvitationPage,
})

function InvitationPage() {
  const result = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!result.ok) {
    return (
      <main className="mx-auto grid max-w-md gap-4 px-4 py-16">
        <h1 className="font-semibold text-2xl">Inbjudan fungerar inte</h1>
        <p>{authErrorMessage({ code: result.code })}</p>
        {result.code === 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION' && (
          <Button
            variant="outline"
            className="h-11 w-full sm:h-9 sm:w-auto sm:justify-self-start"
            onClick={async () => {
              await authClient.signOut()
              await router.invalidate()
            }}
          >
            Logga ut och byt konto
          </Button>
        )}
      </main>
    )
  }

  const { invitation } = result
  const respond = async (accept: boolean) => {
    setPending(true)
    setError(null)
    const response = accept
      ? await authClient.organization.acceptInvitation({ invitationId: invitation.id })
      : await authClient.organization.rejectInvitation({ invitationId: invitation.id })
    if (response.error) {
      setPending(false)
      return setError(authErrorMessage(response.error))
    }
    const joined = accept ? response.data?.invitation?.organizationId : undefined
    if (joined) await authClient.organization.setActive({ organizationId: joined })
    await router.navigate({ to: '/' })
  }

  return (
    <main className="mx-auto grid max-w-md gap-6 px-4 py-16">
      <div className="grid gap-2">
        <h1 className="font-semibold text-2xl">Gå med i {invitation.organizationName}</h1>
        <p>
          {invitation.inviterEmail} har bjudit in dig som{' '}
          {(roleLabels[invitation.role] ?? invitation.role).toLowerCase()}.
        </p>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-3">
        <Button disabled={pending} onClick={() => respond(true)}>
          Acceptera inbjudan
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => respond(false)}>
          Avböj
        </Button>
      </div>
    </main>
  )
}
