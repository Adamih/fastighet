import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import {
  acceptPortalInvitationFn,
  previewPortalInvitationFn,
} from '#/features/portal/public-functions'
import { m } from '#/paraglide/messages'

// The link in a portal invitation email. Accepting gives the invited address access to the
// party's pages (creating its account if needed) and signs it in to Mina sidor.
export const Route = createFileRoute('/portal/invitation')({
  validateSearch: (search): { code?: string } => ({
    code: typeof search.code === 'string' ? search.code : undefined,
  }),
  loaderDeps: ({ search }) => ({ code: search.code }),
  loader: ({ deps }) =>
    deps.code
      ? previewPortalInvitationFn({ data: { code: deps.code } })
      : { ok: false as const, problem: 'Länken är ogiltig.' },
  component: InvitationPage,
})

function InvitationPage() {
  const preview = Route.useLoaderData()
  const { code } = Route.useSearch()
  const router = useRouter()
  const accept = useMutation({
    mutationFn: acceptPortalInvitationFn,
    onSuccess: async () => {
      await router.invalidate()
      await router.navigate({ to: '/portal' })
    },
  })
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{m.portal_invitation_title()}</CardTitle>
          {preview.ok && (
            <CardDescription>
              {m.portal_invitation_intro({
                organization: preview.organizationName,
                party: preview.partyName,
              })}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          {preview.ok ? (
            <>
              <p className="text-sm">{m.portal_invitation_email({ email: preview.email })}</p>
              <Button
                className="h-11 w-full sm:h-10"
                disabled={accept.isPending || !code}
                onClick={() => code && accept.mutate({ data: { code } })}
              >
                {m.portal_invitation_accept()}
              </Button>
              {accept.error && <p className="text-destructive text-sm">{accept.error.message}</p>}
            </>
          ) : (
            <>
              <p className="text-sm">{preview.problem}</p>
              <Link to="/portal/login" className="text-sm underline underline-offset-4">
                {m.portal_login_title()}
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
