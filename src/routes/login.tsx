import { createFileRoute } from '@tanstack/react-router'
import { getSessionFn } from '#/features/auth/functions'
import { OtherWorkspaceNotice } from '#/features/auth/other-workspace'
import { authSearch, beforeAuthPage, PublicAuthPage } from '#/features/auth/public-page'

export const Route = createFileRoute('/login')({
  validateSearch: authSearch,
  beforeLoad: ({ location }) => beforeAuthPage(location, true),
  // Someone signed in to Mina sidor stays here and is told how to switch.
  loader: () => getSessionFn(),
  component: LoginPage,
})

function LoginPage() {
  const session = Route.useLoaderData()
  if (session?.workspace === 'portal') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center px-4 py-16">
        <OtherWorkspaceNotice signedInTo="portal" email={session.email} />
      </main>
    )
  }
  return <PublicAuthPage view="signIn" />
}
