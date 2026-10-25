import { Link, useRouteContext, useRouter, useRouterState } from '@tanstack/react-router'
import {
  Banknote,
  Building2,
  FileText,
  KeyRound,
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
import type { CompanyKind } from '#/features/settings/company-kinds'
import { companyTerms } from '#/features/settings/terminology'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import type { Permissions } from '#/lib/permissions'
import { m } from '#/paraglide/messages'

const navigation = [
  { title: m.nav_properties, to: '/', icon: Building2, permission: { property: ['read'] } },
  {
    title: (kind: CompanyKind) => companyTerms(kind).parties,
    to: '/tenants',
    icon: Users,
    permission: { tenant: ['read'] },
  },
  {
    title: m.nav_ownerships,
    to: '/ownerships',
    icon: KeyRound,
    permission: { lease: ['read'] },
    only: 'brf',
  },
  { title: m.nav_leases, to: '/leases', icon: FileText, permission: { lease: ['read'] } },
  { title: m.nav_invoices, to: '/invoices', icon: Receipt, permission: { invoice: ['read'] } },
  { title: m.nav_payments, to: '/payments', icon: Banknote, permission: { payment: ['read'] } },
  { title: m.nav_team, to: '/team', icon: UserRoundCog, permission: undefined },
  { title: m.nav_settings, to: '/settings', icon: Settings, permission: { settings: ['read'] } },
] as const satisfies readonly {
  /** Some labels follow the company type (Hyresgäster or Medlemmar). */
  title: (kind: CompanyKind) => string
  to: string
  icon: typeof Building2
  permission: Permissions | undefined
  /** Shown only for this company type. */
  only?: CompanyKind
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
            <nav aria-label={m.nav_main_label()}>
              <SidebarMenu>
                {navigation.map((item) => {
                  if (item.permission && !can(item.permission)) return null
                  if ('only' in item && item.only !== app.companyKind) return null
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
                          <span>{item.title(app.companyKind)}</span>
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
                  setError(cause instanceof Error ? cause.message : m.nav_sign_out_failed())
                  setSigningOut(false)
                }
              }}
            >
              <LogOut aria-hidden="true" />
              <span>{signingOut ? m.nav_signing_out() : m.nav_sign_out()}</span>
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
