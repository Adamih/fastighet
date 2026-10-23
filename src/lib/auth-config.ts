import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import { stockholmDate } from '#/lib/dates'
import { ac, roles } from '#/lib/permissions'
import type { AnyEmail } from '#/server/mail/mailer'

/**
 * Hands an email to the mailer without waiting for delivery. Better Auth recommends not awaiting
 * sends so response times do not reveal whether an account exists.
 */
export type DeliverEmail = (email: AnyEmail) => void

const RESET_PASSWORD_TTL_SECONDS = 60 * 60

// Kept free of `cloudflare:workers` so the Better Auth CLI can load it from Node.
export function createAuth(
  db: Db,
  options: { secret?: string; baseURL?: string; deliverEmail: DeliverEmail },
) {
  const { deliverEmail } = options

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
      }),
      // Must stay last so it can forward Set-Cookie headers from the other plugins.
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
