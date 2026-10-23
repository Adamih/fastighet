import { Link, useRouteContext, useRouter, useRouterState } from '@tanstack/react-router'
import {
  Banknote,
  Building2,
  FileText,
  LogOut,
  Receipt,
  Settings,
  UserRoundCog,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '#/components/ui/sidebar'
import { useCan } from '#/features/auth/use-can'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import type { Permissions } from '#/lib/permissions'

const navigation = [
  { title: 'Fastigheter', to: '/', icon: Building2, permission: { property: ['read'] } },
  { title: 'Hyresgäster', to: '/tenants', icon: Users, permission: { tenant: ['read'] } },
  { title: 'Avtal', to: '/leases', icon: FileText, permission: { lease: ['read'] } },
  { title: 'Avier', to: '/invoices', icon: Receipt, permission: { invoice: ['read'] } },
  { title: 'Betalningar', to: '/payments', icon: Banknote, permission: { payment: ['read'] } },
  { title: 'Användare', to: '/team', icon: UserRoundCog, permission: undefined },
  { title: 'Inställningar', to: '/settings', icon: Settings, permission: { settings: ['read'] } },
] as const satisfies readonly {
  title: string
  to: string
  icon: typeof Building2
  permission: Permissions | undefined
}[]

export function AppSidebar() {
  const { app } = useRouteContext({ from: '/_app' })
  const can = useCan()
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { setOpenMobile } = useSidebar()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-5 pr-10">
        <span className="break-words font-semibold">{app.organization.name}</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Huvudnavigation">
              <SidebarMenu>
                {navigation.map((item) => {
                  if (item.permission && !can(item.permission)) return null
                  const active =
                    item.to === '/'
                      ? pathname === '/' || /^\/(properties|units)\//.test(pathname)
                      : pathname === item.to || pathname.startsWith(`${item.to}/`)

                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className="h-11 text-sidebar-foreground"
                      >
                        <Link
                          to={item.to}
                          aria-current={active ? 'page' : undefined}
                          activeOptions={{ exact: item.to === '/' }}
                          onClick={() => setOpenMobile(false)}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator className="mx-3 data-[orientation=horizontal]:w-auto" />
      <SidebarFooter className="p-3">
        <span className="break-all px-2 text-muted-foreground text-sm">{app.user.email}</span>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-11"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true)
                setError(null)
                try {
                  const result = await authClient.signOut()
                  if (result.error) throw new Error(authErrorMessage(result.error))
                  setOpenMobile(false)
                  await router.navigate({ to: '/login' })
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Utloggningen misslyckades')
                  setSigningOut(false)
                }
              }}
            >
              <LogOut aria-hidden="true" />
              <span>{signingOut ? 'Loggar ut…' : 'Logga ut'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {error && (
          <p role="alert" className="px-2 text-destructive text-sm">
            {error}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
