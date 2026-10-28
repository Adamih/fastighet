import { createFileRoute, Outlet, retainSearchParams } from '@tanstack/react-router'
import { AppSidebar } from '#/components/app-sidebar'
import { FormDrawerProvider } from '#/components/form-drawer'
import { SidebarProvider, SidebarTrigger } from '#/components/ui/sidebar'
import { ImpersonationBanner } from '#/features/admin/impersonation-banner'
import { getAppContextFn } from '#/features/auth/functions'
import { m } from '#/paraglide/messages'

// Pathless layout for everything behind login. `getAppContextFn` redirects to /login or
// /onboarding when there is no session or no active company.
//
// `?company=` is the company in focus when it isn't the user's own (`src/lib/focus.ts`). Every
// link keeps it, so the whole app stays in that company until the user switches.
export const Route = createFileRoute('/_app')({
  validateSearch: (search): { company?: string } => ({
    company: typeof search.company === 'string' && search.company ? search.company : undefined,
  }),
  search: { middlewares: [retainSearchParams(['company'])] },
  beforeLoad: async () => ({ app: await getAppContextFn() }),
  component: AppLayout,
})

function AppLayout() {
  const { app } = Route.useRouteContext()

  return (
    <FormDrawerProvider>
      <SidebarProvider className="print:block print:min-h-0">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {app.user.impersonatedBy && <ImpersonationBanner user={app.user} />}
          <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 print:hidden">
            <SidebarTrigger className="size-11 shrink-0" />
            <span className="grid min-w-0">
              <span className="truncate font-semibold" title={app.organization.name}>
                {app.organization.name}
              </span>
              {app.organization.grant && (
                <span className="truncate text-muted-foreground text-xs">
                  {m.company_managed_by({ organization: app.home.name })}
                </span>
              )}
            </span>
          </header>
          <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 print:max-w-none print:p-0">
            <Outlet />
          </main>
        </div>
      </SidebarProvider>
    </FormDrawerProvider>
  )
}
