import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Building, LayoutDashboard, LogOut, ScrollText, Shield, Users } from 'lucide-react'
import { getAdminContextFn } from '#/features/admin/functions'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

// The admin dashboard: its own layout, apart from the app (no company, no sidebar). Only admins
// get past `getAdminContextFn`; everyone else gets a 404, so it doesn't reveal itself.
export const Route = createFileRoute('/admin')({
  beforeLoad: async () => ({ admin: await getAdminContextFn() }),
  component: AdminLayout,
})

const tabs = [
  { to: '/admin', label: m.admin_nav_overview, icon: LayoutDashboard, exact: true },
  { to: '/admin/users', label: m.admin_nav_users, icon: Users, exact: false },
  { to: '/admin/companies', label: m.admin_nav_companies, icon: Building, exact: false },
  { to: '/admin/events', label: m.admin_nav_events, icon: ScrollText, exact: false },
] as const

function AdminLayout() {
  const { admin } = Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <Shield aria-hidden="true" className="size-5" />
            {m.admin_title()}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
            {admin.email}
          </span>
          <Link
            to="/sign-out"
            preload={false}
            className="flex h-11 items-center gap-1.5 text-sm underline-offset-4 hover:underline sm:h-9"
          >
            <LogOut aria-hidden="true" className="size-4" />
            {m.admin_sign_out()}
          </Link>
        </div>
        <nav aria-label={m.admin_title()} className="mx-auto max-w-6xl overflow-x-auto px-2">
          <ul className="flex gap-1">
            {tabs.map((tab) => {
              const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to)
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm',
                      active
                        ? 'border-foreground font-medium'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <tab.icon aria-hidden="true" className="size-4" />
                    {tab.label()}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
