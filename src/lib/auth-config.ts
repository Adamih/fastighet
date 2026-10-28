import { tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'
import { stripe as stripePlugin } from '@better-auth/stripe'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { and, asc, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import type { CompanyAction } from '#/features/audit/actions'
import { stripePlans, tierOf } from '#/features/billing/store'
import { tiers } from '#/features/billing/tiers'
import { stockholmDate } from '#/lib/dates'
import { ac, roles } from '#/lib/permissions'
import type { AnyEmail } from '#/server/mail/mailer'

/**
 * Hands an email to the mailer without waiting for delivery. Better Auth recommends not awaiting
 * sends so response times do not reveal whether an account exists.
 */
export type DeliverEmail = (email: AnyEmail) => void

/** A team or subscription change for the company's audit log. */
export interface CompanyEvent {
  readonly organization: { readonly id: string; readonly name: string }
  /**
   * Who did it; null for Stripe's webhooks, or when Better Auth's request had no session (never
   * expected for team changes).
   */
  readonly actor: { readonly id: string; readonly name: string } | null
  readonly action: CompanyAction
  /** The admin acting as the actor (impersonation), from the request's session. */
  readonly impersonatedById?: string | null
  /** The user (or invitation) it concerns. */
  readonly entityId: string
  readonly details: Readonly<Record<string, string>>
}

/** Records a team or subscription change. Must never throw: the change has already been made. */
export type RecordCompanyEvent = (event: CompanyEvent) => Promise<void>

/** An admin action for the admin log (`features/admin`); never throws. */
export interface AdminEvent {
  readonly actor: { readonly id: string; readonly name: string }
  readonly action: 'impersonate'
  readonly targetUserId: string
  readonly details: Readonly<Record<string, string>>
}
export type RecordAdminEvent = (event: AdminEvent) => Promise<void>

/** How long an admin's impersonation lasts before they are signed out of it. */
export const IMPERSONATION_SECONDS = 60 * 60

/** Sets a subscription's quantity to what the company has; see `features/billing`. */
export type SyncQuantity = (organizationId: string) => Promise<void>

/**
 * The signed-in user of the Better Auth request being handled, for hooks that only say whom a
 * change concerns. Better Auth keeps the request context on `globalThis`, so this works even if a
 * bundler ends up with two copies of `@better-auth/core`.
 */
function requestUser() {
  const user = tryGetCurrentAuthEndpointContext()?.context.session?.user
  return user ? { id: user.id, name: user.name } : null
}

/** The admin behind the request's session when it is an impersonation. */
function requestImpersonator(): string | null {
  const session = tryGetCurrentAuthEndpointContext()?.context.session?.session as
    | { impersonatedBy?: string | null }
    | undefined
  return session?.impersonatedBy ?? null
}

const RESET_PASSWORD_TTL_SECONDS = 60 * 60

// Kept free of `cloudflare:workers` so the Better Auth CLI can load it from Node.
export function createAuth(
  db: Db,
  options: {
    secret?: string
    baseURL?: string
    deliverEmail: DeliverEmail
    recordCompanyEvent: RecordCompanyEvent
    recordAdminEvent: RecordAdminEvent
    /** Stripe for subscriptions. Without a real key, checkout fails and the plan page says so. */
    stripe: { client: Stripe; webhookSecret: string }
    syncQuantity: SyncQuantity
  },
) {
  const { deliverEmail, recordAdminEvent, syncQuantity } = options
  const recordCompanyEvent: RecordCompanyEvent = (event) => {
    const by = requestImpersonator()
    return options.recordCompanyEvent(by ? { ...event, impersonatedById: by } : event)
  }
  const company = (organization: { id: string; name: string }) => ({
    id: organization.id,
    name: organization.name,
  })
  const person = (user: { id: string; name: string }) => ({ id: user.id, name: user.name })
  /** A subscription change from Stripe's webhook, for the company's audit log. */
  const subscriptionEvent = async (
    action: CompanyAction,
    subscription: { id: string; referenceId: string; plan: string },
  ) => {
    const [company] = await db
      .select({ id: schema.organization.id, name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, subscription.referenceId))
    if (!company) return
    await recordCompanyEvent({
      organization: company,
      actor: null,
      action,
      entityId: subscription.id,
      details: { plan: subscription.plan },
    })
  }

  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    disabledPaths: [
      '/organization/leave',
      // Admins work through the dashboard: they never create accounts, set passwords or delete
      // users (whose records the audit log and accounting keep).
      '/admin/create-user',
      '/admin/set-user-password',
      '/admin/remove-user',
      '/admin/update-user',
    ],
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TTL_SECONDS,
      sendResetPassword: async ({ user, url }) =>
        deliverEmail({
          to: user.email,
          template: 'resetPassword',
          props: {
            name: user.name,
            resetUrl: url,
            expiresInMinutes: RESET_PASSWORD_TTL_SECONDS / 60,
          },
        }),
    },
    emailVerification: {
      sendOnSignUp: true,
      // An unverified user who tries to sign in gets a fresh link instead of a dead end.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        deliverEmail({
          to: user.email,
          template: 'verifyEmail',
          props: { name: user.name, verifyUrl: url },
        }),
    },
    databaseHooks: {
      session: {
        create: {
          // Land returning users in their first company instead of the onboarding screen.
          before: async (session) => {
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(asc(schema.member.createdAt))
              .limit(1)
            return {
              data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
            }
          },
          // An admin starting to act as someone goes to the admin log.
          after: async (session) => {
            const by = (session as { impersonatedBy?: string | null }).impersonatedBy
            if (!by) return
            const [admin] = await db
              .select({ id: schema.user.id, name: schema.user.name })
              .from(schema.user)
              .where(eq(schema.user.id, by))
            if (!admin) return
            await recordAdminEvent({
              actor: admin,
              action: 'impersonate',
              targetUserId: session.userId,
              details: {},
            })
          },
        },
      },
    },
    plugins: [
      organization({
        // Roles and permissions shared with the server's `requirePermission` and the UI.
        ac,
        roles,
        creatorRole: 'owner',
        requireEmailVerificationOnInvitation: true,
        // The tier's backstop (a free manager has two users), else Better Auth's default.
        membershipLimit: async (_user, organization) =>
          tiers[await tierOf(db, organization.id)].limits.members ?? 100,
        sendInvitationEmail: async (data) =>
          deliverEmail({
            to: data.email,
            template: 'organizationInvitation',
            props: {
              inviterName: data.inviter.user.name,
              organizationName: data.organization.name,
              acceptUrl: `${options.baseURL ?? ''}/invitations/${data.id}`,
              expiresOn: stockholmDate(data.invitation.expiresAt.getTime()),
            },
          }),
        // Team changes for the company's audit log. Role keys are stored, never role names.
        organizationHooks: {
          afterCreateInvitation: ({ invitation, inviter, organization }) =>
            recordCompanyEvent({
              organization: company(organization),
              actor: person(inviter),
              action: 'team.invite',
              entityId: invitation.id,
              details: { email: invitation.email, role: invitation.role },
            }),
          afterCancelInvitation: ({ invitation, cancelledBy, organization }) =>
            recordCompanyEvent({
              organization: company(organization),
              actor: person(cancelledBy),
              action: 'team.cancel_invitation',
              entityId: invitation.id,
              details: { email: invitation.email },
            }),
          afterAcceptInvitation: ({ member, user, organization }) =>
            recordCompanyEvent({
              organization: company(organization),
              actor: person(user),
              action: 'team.join',
              entityId: user.id,
              details: { name: user.name, role: member.role },
            }),
          afterRejectInvitation: ({ invitation, user, organization }) =>
            recordCompanyEvent({
              organization: company(organization),
              actor: person(user),
              action: 'team.reject_invitation',
              entityId: invitation.id,
              details: { email: invitation.email },
            }),
          // These two say only whom the change concerns; the actor is the request's user.
          afterUpdateMemberRole: ({ member, previousRole, user, organization }) =>
            recordCompanyEvent({
              organization: company(organization),
              actor: requestUser(),
              action: 'team.change_role',
              entityId: user.id,
              details: { name: user.name, role: member.role, previousRole },
            }),
          afterRemoveMember: ({ member, user, organization }) =>
            recordCompanyEvent({
              organization: company(organization),
              actor: requestUser(),
              action: 'team.remove',
              entityId: user.id,
              details: { name: user.name, role: member.role },
            }),
        },
      }),
      // The admin dashboard (`/admin`) and impersonation. Admins are users with the role
      // `admin` (set with `bun run admin:grant`); company roles are separate, on `member`.
      admin({
        impersonationSessionDuration: IMPERSONATION_SECONDS,
        allowImpersonatingAdmins: false,
        bannedUserMessage: 'Kontot är spärrat. Kontakta oss om du tror att det är fel.',
      }),
      // Subscriptions: a company's paid tier is its Stripe subscription (`features/billing`).
      stripePlugin({
        stripeClient: options.stripe.client,
        stripeWebhookSecret: options.stripe.webhookSecret,
        organization: { enabled: true },
        subscription: {
          enabled: true,
          plans: () => stripePlans(options.stripe.client),
          // Only the company's own owners and admins buy for it; a manager's staff never do, and
          // neither does an admin acting as one of them.
          authorizeReference: async ({ user, session, referenceId }) => {
            if ((session as { impersonatedBy?: string | null }).impersonatedBy) return false
            const [membership] = await db
              .select({ role: schema.member.role })
              .from(schema.member)
              .where(
                and(
                  eq(schema.member.userId, user.id),
                  eq(schema.member.organizationId, referenceId),
                ),
              )
            const roles = membership?.role.split(',') ?? []
            return roles.includes('owner') || roles.includes('admin')
          },
          getCheckoutSessionParams: () => ({
            params: {
              locale: 'sv',
              billing_address_collection: 'required',
              tax_id_collection: { enabled: true },
            },
          }),
          // Checkout takes the quantity from the browser; set it to what the company has.
          onSubscriptionComplete: async ({ subscription }) => {
            await syncQuantity(subscription.referenceId)
            await subscriptionEvent('billing.subscribe', subscription)
          },
          // Sales tiers are set up in Stripe's dashboard.
          onSubscriptionCreated: async ({ subscription }) => {
            await syncQuantity(subscription.referenceId)
            await subscriptionEvent('billing.subscribe', subscription)
          },
          onSubscriptionCancel: ({ subscription }) =>
            subscriptionEvent('billing.cancel', subscription),
          onSubscriptionDeleted: ({ subscription }) =>
            subscriptionEvent('billing.end', subscription),
        },
      }),
      // Must stay last so it can forward Set-Cookie headers from the other plugins.
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
