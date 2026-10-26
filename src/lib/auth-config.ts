import { tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import type { TeamAction } from '#/features/audit/actions'
import { stockholmDate } from '#/lib/dates'
import { ac, roles } from '#/lib/permissions'
import type { AnyEmail } from '#/server/mail/mailer'

/**
 * Hands an email to the mailer without waiting for delivery. Better Auth recommends not awaiting
 * sends so response times do not reveal whether an account exists.
 */
export type DeliverEmail = (email: AnyEmail) => void

/** A team change for the company's audit log. */
export interface TeamEvent {
  readonly organization: { readonly id: string; readonly name: string }
  /** Who did it; null when Better Auth's request had no session (never expected). */
  readonly actor: { readonly id: string; readonly name: string } | null
  readonly action: TeamAction
  /** The user (or invitation) it concerns. */
  readonly entityId: string
  readonly details: Readonly<Record<string, string>>
}

/** Records a team change. Must never throw: Better Auth has already made the change. */
export type RecordTeamEvent = (event: TeamEvent) => Promise<void>

/**
 * The signed-in user of the Better Auth request being handled, for hooks that only say whom a
 * change concerns. Better Auth keeps the request context on `globalThis`, so this works even if a
 * bundler ends up with two copies of `@better-auth/core`.
 */
function requestUser() {
  const user = tryGetCurrentAuthEndpointContext()?.context.session?.user
  return user ? { id: user.id, name: user.name } : null
}

const RESET_PASSWORD_TTL_SECONDS = 60 * 60

// Kept free of `cloudflare:workers` so the Better Auth CLI can load it from Node.
export function createAuth(
  db: Db,
  options: {
    secret?: string
    baseURL?: string
    deliverEmail: DeliverEmail
    recordTeamEvent: RecordTeamEvent
  },
) {
  const { deliverEmail, recordTeamEvent } = options
  const company = (organization: { id: string; name: string }) => ({
    id: organization.id,
    name: organization.name,
  })
  const person = (user: { id: string; name: string }) => ({ id: user.id, name: user.name })

  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    disabledPaths: ['/organization/leave'],
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
            recordTeamEvent({
              organization: company(organization),
              actor: person(inviter),
              action: 'team.invite',
              entityId: invitation.id,
              details: { email: invitation.email, role: invitation.role },
            }),
          afterCancelInvitation: ({ invitation, cancelledBy, organization }) =>
            recordTeamEvent({
              organization: company(organization),
              actor: person(cancelledBy),
              action: 'team.cancel_invitation',
              entityId: invitation.id,
              details: { email: invitation.email },
            }),
          afterAcceptInvitation: ({ member, user, organization }) =>
            recordTeamEvent({
              organization: company(organization),
              actor: person(user),
              action: 'team.join',
              entityId: user.id,
              details: { name: user.name, role: member.role },
            }),
          afterRejectInvitation: ({ invitation, user, organization }) =>
            recordTeamEvent({
              organization: company(organization),
              actor: person(user),
              action: 'team.reject_invitation',
              entityId: invitation.id,
              details: { email: invitation.email },
            }),
          // These two say only whom the change concerns; the actor is the request's user.
          afterUpdateMemberRole: ({ member, previousRole, user, organization }) =>
            recordTeamEvent({
              organization: company(organization),
              actor: requestUser(),
              action: 'team.change_role',
              entityId: user.id,
              details: { name: user.name, role: member.role, previousRole },
            }),
          afterRemoveMember: ({ member, user, organization }) =>
            recordTeamEvent({
              organization: company(organization),
              actor: requestUser(),
              action: 'team.remove',
              entityId: user.id,
              details: { name: user.name, role: member.role },
            }),
        },
      }),
      // Must stay last so it can forward Set-Cookie headers from the other plugins.
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
