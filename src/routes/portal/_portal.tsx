import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { getSessionFn } from '#/features/auth/functions'

// Everything in Mina sidor behind login. Without a session: the portal's login page. With an app
// session: the same page, which says to sign out first. The layout itself comes with #20.
export const Route = createFileRoute('/portal/_portal')({
  beforeLoad: async ({ location }) => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/portal/login', search: { redirectTo: location.href } })
    if (session.workspace !== 'portal') throw redirect({ to: '/portal/login' })
    return { session }
  },
  component: () => <Outlet />,
})
