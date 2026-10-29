import { and, count, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  adminEvent,
  managementGrant,
  member,
  organization,
  organizationSettings,
  session,
  subscription,
  unit,
  user,
} from '#/db/schema'
import { planState, usageOf } from '#/features/billing/store'
import { isTierId, resolveTier, type TierId, tiers } from '#/features/billing/tiers'
import { Conflict, NotFound } from '#/server/errors'
import { inCompany, query } from '#/server/scoped'
import { AdminAuth, type AdminAuthError, AdminUser } from '#/server/services'
import type { AdminAction } from './actions'

// The admin dashboard's programs. They run only through `runAdmin` (`src/server/admin.ts`), which
// checks that the signed-in user is an admin and not impersonating anyone. Admins see every
// company, so these read with `query` across companies, never `orgQuery`: the one place that does
// on purpose. They only read company data; the writes are tiers set by agreement and what Better
// Auth's admin endpoints do (bans, roles, sessions), each recorded in the admin log.

const PAYING = ['active', 'trialing', 'past_due']
const LIMIT = 50

/** Records an admin action in the admin log. A failure is logged, never thrown. */
export const recordAdminAction = Effect.fn('admin.recordAdminAction')(
  function* (
    action: AdminAction,
    target: { userId?: string; organizationId?: string },
    details: Record<string, string> = {},
  ) {
    const admin = yield* AdminUser
    yield* query((db) =>
      db.insert(adminEvent).values({
        actorUserId: admin.id,
        actorName: admin.name,
        action,
        targetUserId: target.userId ?? null,
        targetOrganizationId: target.organizationId ?? null,
        details: JSON.stringify(details),
      }),
    )
  },
  Effect.catchCause((cause) => Effect.logError('Could not record admin event', cause)),
)

const search = (text: string) => `%${text.trim().replace(/[%_]/g, '')}%`

/** Counts for the overview: users, companies by type and by tier, paying subscriptions. */
export const overview = Effect.gen(function* () {
  yield* AdminUser
  const [users] = yield* query((db) => db.select({ n: count() }).from(user))
  const companies = yield* allCompanyTiers()
  const [paying] = yield* query((db) =>
    db.select({ n: count() }).from(subscription).where(inArray(subscription.status, PAYING)),
  )
  const byTier = new Map<TierId, number>()
  for (const c of companies) byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + 1)
  return {
    users: users?.n ?? 0,
    companies: companies.length,
    payingSubscriptions: paying?.n ?? 0,
    byTier: [...byTier].map(([tier, n]) => ({ tier, kind: tiers[tier].kind, count: n })),
  }
}).pipe(Effect.withSpan('admin.overview'))

/** Every company's type and tier, in a few queries rather than one per company. */
const allCompanyTiers = (ids?: readonly string[]) =>
  Effect.gen(function* () {
    if (ids && ids.length === 0) return []
    const orgs = yield* query((db) =>
      db
        .select({
          id: organization.id,
          name: organization.name,
          createdAt: organization.createdAt,
          kind: organizationSettings.kind,
          planOverride: organizationSettings.planOverride,
        })
        .from(organization)
        .leftJoin(organizationSettings, eq(organizationSettings.organizationId, organization.id))
        .where(ids ? inArray(organization.id, [...ids]) : undefined),
    )
    const subs = yield* query((db) =>
      db
        .select({
          referenceId: subscription.referenceId,
          plan: subscription.plan,
          status: subscription.status,
        })
        .from(subscription)
        .where(inArray(subscription.status, PAYING)),
    )
    return orgs.map((o) => {
      const kind = o.kind ?? 'landlord'
      const sub = subs.find((s) => s.referenceId === o.id) ?? null
      return { ...o, kind, tier: resolveTier(kind, o.planOverride, sub) }
    })
  })

/** Users matching a name or email, newest first, with their companies. */
export const listUsers = Effect.fn('admin.listUsers')(function* (text: string) {
  yield* AdminUser
  const rows = yield* query((db) =>
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        banned: user.banned,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(
        text.trim() ? or(like(user.name, search(text)), like(user.email, search(text))) : undefined,
      )
      .orderBy(desc(user.createdAt))
      .limit(LIMIT),
  )
  const memberships = yield* membershipsOf(rows.map((r) => r.id))
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
    isAdmin: isAdminRole(r.role),
    banned: r.banned ?? false,
    companies: memberships.filter((m) => m.userId === r.id),
  }))
})

const isAdminRole = (role: string | null) => (role ?? '').split(',').includes('admin')

const membershipsOf = (userIds: readonly string[]) =>
  userIds.length === 0
    ? Effect.succeed([])
    : query((db) =>
        db
          .select({
            userId: member.userId,
            organizationId: member.organizationId,
            name: organization.name,
            role: member.role,
          })
          .from(member)
          .innerJoin(organization, eq(organization.id, member.organizationId))
          .where(inArray(member.userId, [...userIds])),
      )

/** One user: their account, companies, and sessions (an impersonation shows who by). */
export const getUser = Effect.fn('admin.getUser')(function* (userId: string) {
  const admin = yield* AdminUser
  const [row] = yield* query((db) => db.select().from(user).where(eq(user.id, userId)))
  if (!row) return yield* new NotFound({ entity: 'user', id: userId })
  const sessions = yield* query((db) =>
    db
      .select({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        impersonatedBy: session.impersonatedBy,
      })
      .from(session)
      .where(and(eq(session.userId, userId), sql`${session.expiresAt} > ${Date.now()}`))
      .orderBy(desc(session.createdAt)),
  )
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.getTime(),
    isAdmin: isAdminRole(row.role),
    isSelf: row.id === admin.id,
    banned: row.banned ?? false,
    banReason: row.banReason,
    banExpires: row.banExpires?.getTime() ?? null,
    companies: yield* membershipsOf([row.id]),
    sessions: sessions.map((s) => ({
      ...s,
      createdAt: s.createdAt.getTime(),
      expiresAt: s.expiresAt.getTime(),
    })),
  }
})

/** Companies matching a name, newest first, with their type, tier and size. */
export const listCompanies = Effect.fn('admin.listCompanies')(function* (text: string) {
  yield* AdminUser
  const matching = yield* query((db) =>
    db
      .select({ id: organization.id })
      .from(organization)
      .where(text.trim() ? like(organization.name, search(text)) : undefined)
      .orderBy(desc(organization.createdAt))
      .limit(LIMIT),
  )
  const ids = matching.map((o) => o.id)
  const companies = yield* allCompanyTiers(ids)
  const members = yield* countBy(member.organizationId, ids, member)
  const units = yield* countBy(unit.organizationId, ids, unit)
  return companies
    .map((c) => ({
      ...c,
      createdAt: c.createdAt.getTime(),
      members: members.get(c.id) ?? 0,
      units: units.get(c.id) ?? 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
})

const countBy = (
  column: typeof member.organizationId | typeof unit.organizationId,
  ids: readonly string[],
  table: typeof member | typeof unit,
) =>
  Effect.gen(function* () {
    if (ids.length === 0) return new Map<string, number>()
    const rows = yield* query((db) =>
      db
        .select({ id: column, n: count() })
        .from(table)
        .where(inArray(column, [...ids]))
        .groupBy(column),
    )
    return new Map(rows.map((r) => [r.id, r.n]))
  })

/** One company: its details, how its tier is decided, its members and its management grants. */
export const getCompany = Effect.fn('admin.getCompany')(function* (organizationId: string) {
  yield* AdminUser
  const [org] = yield* query((db) =>
    db.select().from(organization).where(eq(organization.id, organizationId)),
  )
  if (!org) return yield* new NotFound({ entity: 'organization', id: organizationId })
  const [settings] = yield* query((db) =>
    db
      .select({
        organizationNumber: organizationSettings.organizationNumber,
        email: organizationSettings.email,
      })
      .from(organizationSettings)
      .where(inCompany(organizationSettings, organizationId)),
  )
  const plan = yield* query((db) => planState(db, organizationId))
  const usage = yield* query((db) => usageOf(db, organizationId))
  const members = yield* query((db) =>
    db
      .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(inCompany(member, organizationId)),
  )
  const grants = yield* query((db) =>
    db
      .select({
        id: managementGrant.id,
        managed: managementGrant.managedOrganizationId,
        managing: managementGrant.managingOrganizationId,
        createdAt: managementGrant.createdAt,
      })
      .from(managementGrant)
      .where(
        and(
          isNull(managementGrant.revokedAt),
          or(
            eq(managementGrant.managedOrganizationId, organizationId),
            eq(managementGrant.managingOrganizationId, organizationId),
          ),
        ),
      ),
  )
  const otherIds = grants.map((g) => (g.managed === organizationId ? g.managing : g.managed))
  const names =
    otherIds.length === 0
      ? []
      : yield* query((db) =>
          db
            .select({ id: organization.id, name: organization.name })
            .from(organization)
            .where(inArray(organization.id, otherIds)),
        )
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? id
  const sub = plan.subscription
  return {
    id: org.id,
    name: org.name,
    createdAt: org.createdAt.getTime(),
    organizationNumber: settings?.organizationNumber ?? null,
    email: settings?.email ?? null,
    kind: plan.kind,
    tier: plan.tier,
    override: plan.override,
    subscription: sub && {
      plan: sub.plan,
      status: sub.status,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      periodEnd: sub.periodEnd?.getTime() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
      seats: sub.seats,
    },
    usage,
    members,
    managedBy: grants
      .filter((g) => g.managed === organizationId)
      .map((g) => ({ id: g.managing, name: nameOf(g.managing) })),
    manages: grants
      .filter((g) => g.managing === organizationId)
      .map((g) => ({ id: g.managed, name: nameOf(g.managed) })),
  }
})

/**
 * Sets the tier we agreed with the company (a sales deal invoiced outside Stripe, a pilot), or
 * clears it so its subscription decides again. It must be a tier of the company's type.
 */
export const setPlanOverride = Effect.fn('admin.setPlanOverride')(function* (input: {
  organizationId: string
  tier: string | null
}) {
  const company = yield* getCompany(input.organizationId)
  if (input.tier !== null && !(isTierId(input.tier) && tiers[input.tier].kind === company.kind)) {
    return yield* new Conflict({ message: 'Välj en nivå för bolagets typ' })
  }
  const tier = input.tier
  yield* query((db) =>
    db
      .insert(organizationSettings)
      .values({ organizationId: company.id, planOverride: tier })
      .onConflictDoUpdate({
        target: organizationSettings.organizationId,
        set: { planOverride: tier },
      }),
  )
  yield* recordAdminAction(
    'set_plan',
    { organizationId: company.id },
    { tier: tier ?? '', previous: company.override ?? '' },
  )
  return { id: company.id }
})

/** The admin log, newest first, with who and what it concerned. */
export const listAdminEvents = Effect.gen(function* () {
  yield* AdminUser
  const rows = yield* query((db) =>
    db
      .select({
        id: adminEvent.id,
        actorName: adminEvent.actorName,
        action: adminEvent.action,
        targetUserId: adminEvent.targetUserId,
        targetUserName: user.name,
        targetOrganizationId: adminEvent.targetOrganizationId,
        targetOrganizationName: organization.name,
        details: adminEvent.details,
        createdAt: adminEvent.createdAt,
      })
      .from(adminEvent)
      .leftJoin(user, eq(user.id, adminEvent.targetUserId))
      .leftJoin(organization, eq(organization.id, adminEvent.targetOrganizationId))
      // Insertion order breaks ties within a millisecond.
      .orderBy(desc(adminEvent.createdAt), desc(sql`${adminEvent}.rowid`))
      .limit(200),
  )
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
    details: r.details ? (JSON.parse(r.details) as Record<string, string>) : {},
  }))
}).pipe(Effect.withSpan('admin.listAdminEvents'))

/** Runs a Better Auth admin endpoint, showing its message if it refuses. */
const viaAuth = (run: (auth: AdminAuth['Service']) => Effect.Effect<void, AdminAuthError>) =>
  Effect.gen(function* () {
    return yield* run(yield* AdminAuth)
  }).pipe(
    Effect.catchTag('AdminAuthError', (error) =>
      Effect.fail(new Conflict({ message: error.reason ?? 'Åtgärden kunde inte genomföras.' })),
    ),
  )

/** A user other than the admin themself; admins are protected from each other's bans. */
const otherUser = (userId: string, what: string) =>
  Effect.gen(function* () {
    const target = yield* getUser(userId)
    if (target.isSelf) return yield* new Conflict({ message: `Du kan inte ${what} dig själv.` })
    return target
  })

/**
 * Bans a user: they can't sign in and are signed out everywhere. An admin must lose the role
 * before they can be banned.
 */
export const banUser = Effect.fn('admin.banUser')(function* (input: {
  userId: string
  reason: string
  days: number | null
}) {
  const target = yield* otherUser(input.userId, 'spärra')
  if (target.isAdmin) {
    return yield* new Conflict({ message: 'Ta bort administratörsbehörigheten först.' })
  }
  const reason = input.reason.trim()
  if (!reason) return yield* new Conflict({ message: 'Ange varför kontot spärras.' })
  yield* viaAuth((auth) =>
    auth.ban(target.id, reason, input.days === null ? null : input.days * 24 * 60 * 60),
  )
  yield* recordAdminAction(
    'ban',
    { userId: target.id },
    { reason, days: input.days === null ? '' : String(input.days) },
  )
  return { id: target.id }
})

export const unbanUser = Effect.fn('admin.unbanUser')(function* (userId: string) {
  const target = yield* getUser(userId)
  yield* viaAuth((auth) => auth.unban(target.id))
  yield* recordAdminAction('unban', { userId: target.id })
  return { id: target.id }
})

/** Gives or takes the admin role. Nobody changes their own, so there is always an admin left. */
export const setAdmin = Effect.fn('admin.setAdmin')(function* (input: {
  userId: string
  admin: boolean
}) {
  const target = yield* otherUser(input.userId, 'ändra behörigheten för')
  if (target.banned && input.admin) {
    return yield* new Conflict({ message: 'Häv spärren först.' })
  }
  yield* viaAuth((auth) => auth.setAdmin(target.id, input.admin))
  yield* recordAdminAction('set_role', { userId: target.id }, { admin: String(input.admin) })
  return { id: target.id }
})

/** Signs the user out on every device, e.g. after a lost phone. */
export const revokeSessions = Effect.fn('admin.revokeSessions')(function* (userId: string) {
  const target = yield* otherUser(userId, 'logga ut')
  yield* viaAuth((auth) => auth.revokeSessions(target.id))
  yield* recordAdminAction('revoke_sessions', { userId: target.id })
  return { id: target.id }
})
