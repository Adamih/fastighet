import { Link, useRouteContext, useRouter, useRouterState } from '@tanstack/react-router'
import {
  Banknote,
  BookOpenCheck,
  Briefcase,
  Building2,
  CreditCard,
  FileText,
  Handshake,
  KeyRound,
  LayoutGrid,
  LogOut,
  Receipt,
  Settings,
  UserRoundCog,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
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
import type { PlanFeature } from '#/features/billing/tiers'
import { usePlan } from '#/features/billing/use-plan'
import type { CompanyKind } from '#/features/settings/company-kinds'
import { companyTerms } from '#/features/settings/terminology'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import type { Permissions } from '#/lib/permissions'
import { m } from '#/paraglide/messages'

const navigation = [
  {
    title: m.nav_portfolio,
    to: '/portfolio',
    icon: LayoutGrid,
    permission: undefined,
    own: true,
    feature: 'portfolio',
    showIf: (app: { companies: readonly unknown[] }) => app.companies.length > 1,
  },
  {
    title: m.nav_properties,
    to: '/',
    icon: Building2,
    permission: { property: ['read'] },
    except: 'manager',
  },
  {
    title: (kind: CompanyKind) => companyTerms(kind).parties,
    to: '/tenants',
    icon: Users,
    permission: { tenant: ['read'] },
    except: 'manager',
  },
  {
    title: m.nav_ownerships,
    to: '/ownerships',
    icon: KeyRound,
    permission: { lease: ['read'] },
    only: 'brf',
  },
  {
    title: m.nav_leases,
    to: '/leases',
    icon: FileText,
    permission: { lease: ['read'] },
    except: 'manager',
  },
  {
    title: m.nav_invoices,
    to: '/invoices',
    icon: Receipt,
    permission: { invoice: ['read'] },
    except: 'manager',
  },
  {
    title: m.nav_payments,
    to: '/payments',
    icon: Banknote,
    permission: { payment: ['read'] },
    except: 'manager',
  },
  {
    title: m.nav_bookkeeping,
    to: '/bookkeeping',
    icon: BookOpenCheck,
    permission: { bookkeeping: ['read'] },
    except: 'manager',
  },
  { title: m.nav_team, to: '/team', icon: UserRoundCog, permission: undefined, own: true },
  {
    title: m.nav_clients,
    to: '/clients',
    icon: Briefcase,
    permission: { client: ['read'] },
    own: true,
    feature: 'clients',
    // Members see it once their company manages someone; owners and admins can start there.
    showIf: (app: { companies: readonly unknown[] }, can: (p: Permissions) => boolean) =>
      app.companies.length > 1 || can({ client: ['manage'] }),
  },
  {
    title: m.nav_managers,
    to: '/management',
    icon: Handshake,
    permission: { grant: ['read'] },
    own: true,
  },
  {
    title: m.nav_plan,
    to: '/plan',
    icon: CreditCard,
    permission: { settings: ['read'] },
    own: true,
  },
  { title: m.nav_settings, to: '/settings', icon: Settings, permission: { settings: ['read'] } },
] as const satisfies readonly {
  /** Some labels follow the company type (Hyresgäster or Medlemmar). */
  title: (kind: CompanyKind) => string
  to: string
  icon: typeof Building2
  permission: Permissions | undefined
  /** Shown only for this company type. */
  only?: CompanyKind
  /** Not shown for this company type (a manager has no properties of its own). */
  except?: CompanyKind
  /** Shown only when the tier includes it. */
  feature?: PlanFeature
  /** Shown only in the user's own company, not in one their company manages. */
  own?: boolean
  showIf?: (app: { companies: readonly unknown[] }, can: (p: Permissions) => boolean) => boolean
}[]

export function AppSidebar() {
  const { app } = useRouteContext({ from: '/_app' })
  const can = useCan()
  const plan = usePlan()
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { setOpenMobile } = useSidebar()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-5 pr-10">
        {app.companies.length > 1 ? (
          <CompanySwitcher onSwitch={() => setOpenMobile(false)} />
        ) : (
          <span className="break-words font-semibold">{app.organization.name}</span>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label={m.nav_main_label()}>
              <SidebarMenu>
                {navigation.map((item) => {
                  if (item.permission && !can(item.permission)) return null
                  if ('only' in item && item.only !== app.companyKind) return null
                  if ('except' in item && item.except === app.companyKind) return null
                  if ('feature' in item && !plan.allows(item.feature)) return null
                  if ('own' in item && item.own && app.organization.grant) return null
                  if ('showIf' in item && !item.showIf(app, can)) return null
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

/** The switcher's "Alla bolag": the overview of every company, not a company in focus. */
const ALL = '*all'

/**
 * Switches the company in focus: the user's own, or one their company manages. The choice lives
 * in the URL (`?company=`), so each tab can show its own company.
 */
function CompanySwitcher({ onSwitch }: { onSwitch: () => void }) {
  const { app } = useRouteContext({ from: '/_app' })
  const router = useRouter()
  const own = app.companies.filter((c) => !c.managed)
  const managed = app.companies.filter((c) => c.managed)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <Select
      value={pathname === '/portfolio' ? ALL : app.organization.id}
      onValueChange={async (id) => {
        onSwitch()
        await router.navigate(
          id === ALL
            ? { to: '/portfolio', search: { company: undefined } }
            : { to: '/', search: { company: id === app.home.id ? undefined : id } },
        )
      }}
    >
      <SelectTrigger
        className="h-11 w-full font-semibold sm:h-10"
        aria-label={m.company_switch_label()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{m.company_switch_all()}</SelectItem>
        <SelectGroup>
          <SelectLabel>{m.company_switch_own()}</SelectLabel>
          {own.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>{m.company_switch_managed()}</SelectLabel>
          {managed.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
