import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { getSessionFn } from '#/features/auth/functions'
import { OtherWorkspaceNotice } from '#/features/auth/other-workspace'
import { authSearch } from '#/features/auth/public-page'
import { PortalLoginForm } from '#/features/portal/login-form'
import { portalDestination } from '#/lib/auth-navigation'
import { m } from '#/paraglide/messages'

// Mina sidor's own login page: a code sent by email. Signed in to Mina sidor already: straight
// in. Signed in to the app: told to sign out first (`src/lib/workspace.ts`).
export const Route = createFileRoute('/portal/login')({
  validateSearch: authSearch,
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn()
    if (session?.workspace === 'portal')
      throw redirect({ href: portalDestination(search.redirectTo) })
    return { session }
  },
  component: PortalLoginPage,
})

function PortalLoginPage() {
  const { session } = Route.useRouteContext()
  const { redirectTo } = Route.useSearch()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-4 px-4 py-16">
      {session ? (
        <OtherWorkspaceNotice signedInTo="staff" email={session.email} />
      ) : (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">{m.portal_login_title()}</CardTitle>
            <CardDescription>{m.portal_login_intro()}</CardDescription>
          </CardHeader>
          <CardContent>
            <PortalLoginForm redirectTo={redirectTo} />
          </CardContent>
        </Card>
      )}
      <p className="text-center text-muted-foreground text-sm">
        {m.workspace_staff_question()}{' '}
        <Link to="/login" className="font-medium text-foreground underline underline-offset-4">
          {m.workspace_staff_login()}
        </Link>
      </p>
    </main>
  )
}
