import type { StripePlan } from '@better-auth/stripe'
import { and, count, eq, inArray } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { Db } from '#/db'
import { member, organizationSettings, subscription, unit } from '#/db/schema'
import { inCompany } from '#/server/scoped'
import { isTierId, type PlanUsage, resolveTier, type TierId, tierIds, tiers } from './tiers'

// A company's tier and usage, read with plain Drizzle so Better Auth's hooks (`auth-config.ts`)
// can use them as well as the Effect programs (`program.ts`). These read the company named, so
// callers pass the company they act for. Kept free of `cloudflare:workers` for the auth CLI.

/** Subscription states the plugin can leave a company in; the latest row is the one that counts. */
const PAYING = ['active', 'trialing', 'past_due'] as const

/** The company's current Stripe subscription row, if it has one that pays (or is retrying). */
export async function payingSubscription(db: Db, organizationId: string) {
  const [row] = await db
    .select()
    .from(subscription)
    .where(
      and(eq(subscription.referenceId, organizationId), inArray(subscription.status, [...PAYING])),
    )
    .limit(1)
  return row ?? null
}

/** The company's type, the tier we set (if any) and its paying subscription. */
export async function planState(db: Db, organizationId: string) {
  const [settings] = await db
    .select({ kind: organizationSettings.kind, planOverride: organizationSettings.planOverride })
    .from(organizationSettings)
    .where(inCompany(organizationSettings, organizationId))
  const kind = settings?.kind ?? 'landlord'
  const paying = await payingSubscription(db, organizationId)
  return {
    kind,
    override: settings?.planOverride ?? null,
    subscription: paying,
    tier: resolveTier(kind, settings?.planOverride ?? null, paying),
  }
}

export async function tierOf(db: Db, organizationId: string): Promise<TierId> {
  return (await planState(db, organizationId)).tier
}

/** What the company has that a tier's price or limits count. */
export async function usageOf(db: Db, organizationId: string): Promise<PlanUsage> {
  const units = await db
    .select({ kind: unit.kind, n: count() })
    .from(unit)
    .where(inCompany(unit, organizationId))
    .groupBy(unit.kind)
  const [members] = await db
    .select({ n: count() })
    .from(member)
    .where(inCompany(member, organizationId))
  const of = (kind: string) => units.find((u) => u.kind === kind)?.n ?? 0
  return {
    apartments: of('apartment'),
    units: of('apartment') + of('commercial'),
    members: members?.n ?? 0,
  }
}

let plansCache: Promise<StripePlan[]> | null = null

/**
 * The paid tiers as the Stripe plugin's plans. Each tier's Stripe price has the tier id as lookup
 * key; it is resolved to the price id once per isolate, because per-user tiers need it as the
 * plugin's `seatPriceId` (which then follows the members itself). Without Stripe, the plans keep
 * their lookup keys and checkout fails with Stripe's error.
 */
export function stripePlans(client: Stripe): Promise<StripePlan[]> {
  plansCache ??= loadPlans(client).catch((cause) => {
    plansCache = null
    console.error('Could not load Stripe prices', cause)
    return paidTiers().map((id) => ({ name: id, lookupKey: id }))
  })
  return plansCache
}

const paidTiers = () => tierIds.filter((id) => tiers[id].price !== null)

async function loadPlans(client: Stripe): Promise<StripePlan[]> {
  const prices = await client.prices.list({ lookup_keys: paidTiers(), active: true, limit: 100 })
  return paidTiers().map((id) => {
    const price = prices.data.find((p) => p.lookup_key === id)
    if (!price) return { name: id, lookupKey: id }
    const perUser = tiers[id].quantity === 'members'
    return {
      name: id,
      priceId: price.id,
      ...(perUser ? { seatPriceId: price.id } : {}),
      // Quantity changes show on the next bill rather than as small extra charges.
      prorationBehavior: 'none',
    }
  })
}

/**
 * Sets the company's subscription quantity to what it has (apartments, or apartments and
 * premises), from the next bill. Per-user tiers are left to the plugin.
 */
export async function syncQuantity(db: Db, client: Stripe, organizationId: string) {
  const row = await payingSubscription(db, organizationId)
  if (!row?.stripeSubscriptionId || !isTierId(row.plan)) return
  const what = tiers[row.plan].quantity
  if (what === null || what === 'members') return
  const quantity = Math.max(1, (await usageOf(db, organizationId))[what])
  if (row.seats === quantity) return
  const stripeSubscription = await client.subscriptions.retrieve(row.stripeSubscriptionId)
  const item =
    stripeSubscription.items.data.find((i) => i.price.lookup_key === row.plan) ??
    stripeSubscription.items.data[0]
  if (!item) return
  await client.subscriptions.update(row.stripeSubscriptionId, {
    items: [{ id: item.id, quantity }],
    proration_behavior: 'none',
  })
  await db.update(subscription).set({ seats: quantity }).where(eq(subscription.id, row.id))
}
