import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppSidebar } from '#/components/app-sidebar'
import { FormDrawerProvider } from '#/components/form-drawer'
import { SidebarProvider, SidebarTrigger } from '#/components/ui/sidebar'
import { getAppContextFn } from '#/features/auth/functions'

// Pathless layout for everything behind login. `getAppContextFn` redirects to /login or
// /onboarding when there is no session or no active company.
export const Route = createFileRoute('/_app')({
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
          <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 print:hidden">
            <SidebarTrigger className="size-11 shrink-0" />
            <span className="min-w-0 truncate font-semibold" title={app.organization.name}>
              {app.organization.name}
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
