import {
  createFileRoute,
  Link,
  Outlet,
  retainSearchParams,
  useNavigate,
} from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { FormDrawerProvider } from '#/components/form-drawer'
import { Button } from '#/components/ui/button'
import { ImpersonationBanner } from '#/features/admin/impersonation-banner'
import { portalNav } from '#/features/portal/nav'
import { getPortalContextFn } from '#/features/portal/portal-functions'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

// Mina sidor behind login: the person, the company in focus (`?company=`, kept on every link)
// and its navigation. `getPortalContextFn` sends anyone without a Mina sidor session to the
// portal's login page. There is no link to the app: the only way across is signing out.
export const Route = createFileRoute('/portal/_portal')({
  validateSearch: (search): { company?: string } => ({
    company: typeof search.company === 'string' && search.company ? search.company : undefined,
  }),
  search: { middlewares: [retainSearchParams(['company'])] },
  beforeLoad: async () => ({ portal: await getPortalContextFn() }),
  component: PortalLayout,
})

function PortalLayout() {
  const { portal } = Route.useRouteContext()
  const navigate = useNavigate()
  const company = portal.company
  const items = portalNav.filter((item) => !item.brf || company?.kind === 'brf')

  return (
    <FormDrawerProvider>
      <div className="flex min-h-dvh flex-col pb-20 md:pb-0">
        {portal.user.impersonatedBy && <ImpersonationBanner user={portal.user} />}
        <header className="border-b">
          <div className="mx-auto flex h-16 w-full max-w-4xl items-center gap-3 px-4">
            <span className="grid min-w-0 flex-1">
              <span className="font-semibold">{m.portal_access_title()}</span>
              {portal.companies.length > 1 && company ? (
                <label className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
                  <span className="sr-only">{m.portal_company_switch()}</span>
                  <select
                    className="min-w-0 truncate rounded-md border bg-background px-1.5 py-0.5"
                    value={company.id}
                    onChange={(event) =>
                      navigate({ to: '/portal', search: { company: event.target.value } })
                    }
                  >
                    {portal.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                company && (
                  <span className="truncate text-muted-foreground text-xs">{company.name}</span>
                )
              )}
            </span>
            <nav aria-label={m.portal_nav_label()} className="hidden gap-1 md:flex">
              {items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.exact }}
                  className="rounded-md px-3 py-2 font-medium text-muted-foreground text-sm hover:bg-accent hover:text-foreground data-[status=active]:text-foreground"
                >
                  {item.label()}
                </Link>
              ))}
            </nav>
            <Button variant="ghost" size="icon" className="size-11 sm:size-9" asChild>
              <Link
                to="/portal/sign-out"
                aria-label={m.workspace_sign_out()}
                title={m.workspace_sign_out()}
              >
                <LogOut aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-4xl flex-1 px-4 py-6 md:py-8">
          {company ? (
            <Outlet />
          ) : (
            <section className="grid gap-2 rounded-xl border bg-card p-5">
              <h1 className="font-semibold text-lg">{m.portal_no_access_title()}</h1>
              <p className="text-muted-foreground text-sm">{m.portal_no_access()}</p>
            </section>
          )}
        </main>
        {company && items.length > 1 && (
          <nav
            aria-label={m.portal_nav_label()}
            className="fixed inset-x-0 bottom-0 z-10 grid border-t bg-background md:hidden"
            style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
          >
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact }}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-muted-foreground text-xs',
                  'data-[status=active]:text-foreground',
                )}
              >
                <item.icon aria-hidden="true" className="size-5" />
                {item.label()}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </FormDrawerProvider>
  )
}
