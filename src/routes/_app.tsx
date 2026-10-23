import { createFileRoute, Link, Outlet, useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { getAppContextFn } from '#/features/auth/functions'
import { authClient } from '#/lib/auth-client'

// Pathless layout for everything behind login. `getAppContextFn` redirects to /login or
// /onboarding when there is no session or no active company.
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => ({ app: await getAppContextFn() }),
  component: AppLayout,
})

function AppLayout() {
  const { app } = Route.useRouteContext()
  const router = useRouter()

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">{app.organization.name}</span>
          <nav className="flex gap-4 text-sm">
            <Link
              to="/"
              className="text-muted-foreground [&.active]:text-foreground"
              activeOptions={{ exact: true }}
            >
              Fastigheter
            </Link>
            <Link to="/tenants" className="text-muted-foreground [&.active]:text-foreground">
              Hyresgäster
            </Link>
            <Link to="/leases" className="text-muted-foreground [&.active]:text-foreground">
              Avtal
            </Link>
            <Link to="/team" className="text-muted-foreground [&.active]:text-foreground">
              Användare
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{app.user.email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await authClient.signOut()
                await router.navigate({ to: '/login' })
              }}
            >
              Logga ut
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
