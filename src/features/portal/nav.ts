import type { LucideIcon } from 'lucide-react'
import { Building2, FileText, House, Receipt } from 'lucide-react'
import { m } from '#/paraglide/messages'

// Mina sidor's navigation, in order. `brf` items show only in a förening.

export interface PortalNavItem {
  readonly to: '/portal' | '/portal/avier' | '/portal/avtal' | '/portal/lagenhet'
  readonly label: () => string
  readonly icon: LucideIcon
  readonly exact?: boolean
  readonly brf?: boolean
}

export const portalNav: readonly PortalNavItem[] = [
  { to: '/portal', label: m.portal_nav_overview, icon: House, exact: true },
  { to: '/portal/avier', label: m.portal_nav_invoices, icon: Receipt },
  { to: '/portal/avtal', label: m.portal_nav_agreements, icon: FileText },
  { to: '/portal/lagenhet', label: m.portal_nav_apartment, icon: Building2, brf: true },
]
