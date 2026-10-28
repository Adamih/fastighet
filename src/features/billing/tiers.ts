import type { CompanyKind } from '#/features/settings/company-kinds'
import { m } from '#/paraglide/messages'

// Client-safe: the subscription tiers, three per company type, and what each allows. This module
// is the one place that defines them: the server's checks (`requireFeature`, `requireWithinLimit`),
// the UI's hints (`usePlan`) and the plan page's comparison all read it, so a tier changes here.
//
// A paid tier is a plan of Better Auth's Stripe plugin with the same name; its Stripe price has
// the tier id as lookup key. A company without an active subscription is on its type's free tier.

export const tierIds = [
  'brf_free',
  'brf_plus',
  'brf_pro',
  'landlord_free',
  'landlord',
  'landlord_pro',
  'manager_free',
  'manager',
  'manager_pro',
] as const
export type TierId = (typeof tierIds)[number]

/** What the tiers gate. Only features that exist; coming ones are rows without a feature. */
export const planFeatures = [
  /** Creating leases (hyresavtal). Core for landlords; a BRF's lettings. */
  'leases',
  /** Leases with VAT or an index clause, and the yearly indexation. */
  'commercial',
  /** The SIE export and the company's own account plan. */
  'bookkeeping',
  /** Managing other companies: requests, grants, assignments. Checked in the user's own company. */
  'clients',
  /** "Alla bolag", all clients side by side. Checked in the user's own company. */
  'portfolio',
] as const
export type PlanFeature = (typeof planFeatures)[number]

/** Features of the manager's own business, checked in the home company, not the one in focus. */
export const homeFeatures: ReadonlySet<PlanFeature> = new Set(['clients', 'portfolio'])

/**
 * What a tier's price counts: apartments; apartments and premises (not parking or storage); or
 * users, which Better Auth's Stripe plugin keeps in step with the members itself.
 */
export type Quantity = 'apartments' | 'units' | 'members'

export interface Tier {
  readonly id: TierId
  readonly kind: CompanyKind
  readonly name: () => string
  /** How the price is counted, e.g. "per lägenhet och månad"; null when free. */
  readonly price: (() => string) | null
  /** Sold through sales, not checkout. */
  readonly sales: boolean
  readonly quantity: Quantity | null
  /** Backstops: at most this many billable units, or members. */
  readonly limits: { readonly units?: number; readonly members?: number }
}

const tier = (t: Tier) => t

/** The free landlord and manager tiers' backstops. */
const FREE_UNITS = 5
const FREE_MEMBERS = 2

export const tiers: Record<TierId, Tier> = {
  brf_free: tier({
    id: 'brf_free',
    kind: 'brf',
    name: m.tier_brf_free,
    price: null,
    sales: false,
    quantity: null,
    limits: {},
  }),
  brf_plus: tier({
    id: 'brf_plus',
    kind: 'brf',
    name: m.tier_brf_plus,
    price: m.tier_price_per_apartment,
    sales: false,
    quantity: 'apartments',
    limits: {},
  }),
  brf_pro: tier({
    id: 'brf_pro',
    kind: 'brf',
    name: m.tier_brf_pro,
    price: m.tier_price_per_apartment,
    sales: false,
    quantity: 'apartments',
    limits: {},
  }),
  landlord_free: tier({
    id: 'landlord_free',
    kind: 'landlord',
    name: m.tier_landlord_free,
    price: null,
    sales: false,
    quantity: null,
    limits: { units: FREE_UNITS },
  }),
  landlord: tier({
    id: 'landlord',
    kind: 'landlord',
    name: m.tier_landlord,
    price: m.tier_price_per_home,
    sales: false,
    quantity: 'apartments',
    limits: {},
  }),
  landlord_pro: tier({
    id: 'landlord_pro',
    kind: 'landlord',
    name: m.tier_landlord_pro,
    price: m.tier_price_per_unit,
    sales: true,
    quantity: 'units',
    limits: {},
  }),
  manager_free: tier({
    id: 'manager_free',
    kind: 'manager',
    name: m.tier_manager_free,
    price: null,
    sales: false,
    quantity: null,
    limits: { members: FREE_MEMBERS },
  }),
  manager: tier({
    id: 'manager',
    kind: 'manager',
    name: m.tier_manager,
    price: m.tier_price_per_user,
    sales: false,
    quantity: 'members',
    limits: {},
  }),
  manager_pro: tier({
    id: 'manager_pro',
    kind: 'manager',
    name: m.tier_manager_pro,
    price: m.tier_price_per_user,
    sales: true,
    quantity: 'members',
    limits: {},
  }),
}

/** A tier's cell in the comparison: included, not available, or charged by use on top. */
export type Cell = boolean | { readonly text: () => string }

export interface PlanRow {
  readonly label: () => string
  /** The feature the row gates; rows without one are described but not enforced. */
  readonly feature?: PlanFeature
  /** Not built yet. */
  readonly soon?: boolean
  /** Free, middle and top tier. */
  readonly cells: readonly [Cell, Cell, Cell]
}

const perUse = (text: () => string) => ({ text })

/** Each company type's tiers, cheapest first, and the rows that compare them. */
export const plans: Record<
  CompanyKind,
  { readonly tiers: readonly [TierId, TierId, TierId]; readonly rows: readonly PlanRow[] }
> = {
  brf: {
    tiers: ['brf_free', 'brf_plus', 'brf_pro'],
    rows: [
      { label: m.plan_row_register, cells: [true, true, true] },
      { label: m.plan_row_brf_billing, cells: [true, true, true] },
      { label: m.plan_row_brf_fees, cells: [true, true, true] },
      { label: m.plan_row_manager_access, cells: [true, true, true] },
      {
        label: m.plan_row_brf_lettings,
        feature: 'leases',
        cells: [false, perUse(m.plan_cell_per_let_object), true],
      },
      {
        label: m.plan_row_brf_commercial,
        feature: 'commercial',
        cells: [false, perUse(m.plan_cell_per_let_object), true],
      },
      { label: m.plan_row_bookkeeping, feature: 'bookkeeping', cells: [false, true, true] },
      { label: m.plan_row_audit, soon: true, cells: [false, true, true] },
      { label: m.plan_row_integration, soon: true, cells: [false, false, true] },
      { label: m.plan_row_member_portal, soon: true, cells: [false, false, true] },
      { label: m.plan_row_cases, soon: true, cells: [false, false, true] },
      { label: m.plan_row_branding, soon: true, cells: [false, false, true] },
    ],
  },
  landlord: {
    tiers: ['landlord_free', 'landlord', 'landlord_pro'],
    rows: [
      {
        label: m.plan_row_landlord_register,
        feature: 'leases',
        cells: [perUse(() => m.plan_cell_up_to_units({ count: FREE_UNITS })), true, true],
      },
      { label: m.plan_row_landlord_billing, cells: [true, true, true] },
      { label: m.plan_row_parking, cells: [true, true, true] },
      {
        label: m.plan_row_landlord_commercial,
        feature: 'commercial',
        cells: [false, perUse(m.plan_cell_per_premises), true],
      },
      { label: m.plan_row_bookkeeping, feature: 'bookkeeping', cells: [false, true, true] },
      { label: m.plan_row_audit, soon: true, cells: [false, true, true] },
      { label: m.plan_row_integration, soon: true, cells: [false, false, true] },
      {
        label: m.plan_row_tenant_portal,
        soon: true,
        cells: [false, perUse(m.plan_cell_per_unit), true],
      },
      { label: m.plan_row_cases, soon: true, cells: [false, perUse(m.plan_cell_per_unit), true] },
      { label: m.plan_row_branding, soon: true, cells: [false, false, true] },
    ],
  },
  manager: {
    tiers: ['manager_free', 'manager', 'manager_pro'],
    rows: [
      { label: m.plan_row_clients, feature: 'clients', cells: [true, true, true] },
      {
        label: m.plan_row_staff,
        cells: [perUse(() => m.plan_cell_up_to_users({ count: FREE_MEMBERS })), true, true],
      },
      { label: m.plan_row_portfolio, feature: 'portfolio', cells: [false, true, true] },
      { label: m.plan_row_staff_activity, soon: true, cells: [false, true, true] },
      {
        label: m.plan_row_pay_for_clients,
        soon: true,
        cells: [false, false, perUse(m.plan_cell_per_client_unit)],
      },
      {
        label: m.plan_row_client_features,
        cells: [
          perUse(m.plan_cell_client_pays),
          perUse(m.plan_cell_client_pays),
          perUse(m.plan_cell_included),
        ],
      },
      { label: m.plan_row_branding_clients, soon: true, cells: [false, false, true] },
    ],
  },
}

/** Whether the tier allows the feature: a row for it whose cell isn't "not available". */
export function tierAllows(tierId: TierId, feature: PlanFeature): boolean {
  const t = tiers[tierId]
  const plan = plans[t.kind]
  const column = plan.tiers.indexOf(tierId)
  const row = plan.rows.find((r) => r.feature === feature)
  return row !== undefined && row.cells[column] !== false
}

/** The cheapest tier of the company's type that allows the feature, for "needs X" hints. */
export function cheapestTierFor(kind: CompanyKind, feature: PlanFeature): Tier | null {
  const id = plans[kind].tiers.find((t) => tierAllows(t, feature))
  return id ? tiers[id] : null
}

/** Subscription states in which a paid tier applies; past due keeps it while Stripe retries. */
const payingStatuses: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due'])

export const isTierId = (value: string): value is TierId =>
  (tierIds as readonly string[]).includes(value)

/**
 * The company's tier: one we set ourselves (`override`, e.g. a sales deal invoiced outside
 * Stripe), else its paying Stripe subscription, else its type's free tier. A tier of another
 * company type (the type was changed since) doesn't apply.
 */
export function resolveTier(
  kind: CompanyKind,
  override: string | null,
  subscription: { readonly plan: string; readonly status: string } | null,
): TierId {
  const ofKind = (id: string | null | undefined): id is TierId =>
    !!id && isTierId(id) && tiers[id].kind === kind
  if (ofKind(override)) return override
  if (subscription && payingStatuses.has(subscription.status) && ofKind(subscription.plan)) {
    return subscription.plan
  }
  return plans[kind].tiers[0]
}

/** What the company has that a tier's price or limits count. */
export interface PlanUsage {
  readonly apartments: number
  /** Apartments and premises. */
  readonly units: number
  readonly members: number
}

export const quantityOf = (tierId: TierId, usage: PlanUsage): number | null => {
  const q = tiers[tierId].quantity
  return q === null ? null : usage[q]
}

/** Whether one more unit or member would go past the tier's backstop. */
export function limitReached(
  tierId: TierId,
  limit: 'units' | 'members',
  usage: PlanUsage,
): boolean {
  const max = tiers[tierId].limits[limit]
  return max !== undefined && usage[limit] >= max
}

/** Where "Kontakta oss" for the sales tiers goes; null shows the text without a link. */
export const salesEmail: string | null = null
