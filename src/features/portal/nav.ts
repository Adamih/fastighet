import type { LucideIcon } from 'lucide-react'
import { House, Receipt } from 'lucide-react'
import { m } from '#/paraglide/messages'

// Mina sidor's navigation, in order. `brf` items show only in a förening.

export interface PortalNavItem {
  readonly to: '/portal' | '/portal/avier'
  readonly label: () => string
  readonly icon: LucideIcon
  readonly exact?: boolean
  readonly brf?: boolean
}

export const portalNav: readonly PortalNavItem[] = [
  { to: '/portal', label: m.portal_nav_overview, icon: House, exact: true },
  { to: '/portal/avier', label: m.portal_nav_invoices, icon: Receipt },
]
