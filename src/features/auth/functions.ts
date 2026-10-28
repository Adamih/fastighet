import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Effect, Schema } from 'effect'
import { tierOf } from '#/features/billing/store'
import { loadSettings } from '#/features/settings/program'
import { auth } from '#/lib/auth'
import { managedCompanies } from '#/server/focus'
import { getSessionOrNull, hasAnyMembership, runApp } from '#/server/run'
import { query } from '#/server/scoped'
import { CurrentOrganization, CurrentUser, HomeOrganization } from '#/server/services'

/** Session summary for the login and onboarding routes, which run before a company exists. */
export const getSessionFn = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSessionOrNull()
  if (!session) return null
  return {
    userId: session.user.id,
    // Checked against the member table: the session's active company may be one the user left.
    hasOrganization: await hasAnyMembership(session.user.id),
  }
})

/**
 * Signed-in user, the company in focus with its type (which sets the app's wording) and tier,
 * their own company with its tier, and the companies they can switch to; redirects to /login or
 * /onboarding otherwise.
 */
export const getAppContextFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(
    Effect.gen(function* () {
      const user = yield* CurrentUser
      const home = yield* HomeOrganization
      const managed = yield* managedCompanies(user.id, home)
      const organization = yield* CurrentOrganization
      return {
        user,
        organization,
        home: { id: home.id, name: home.name },
        companies: [
          { id: home.id, name: home.name, managed: false },
          ...managed.map((c) => ({ id: c.id, name: c.name, managed: true })),
        ],
        companyKind: (yield* loadSettings).kind,
        /** The tier of the company in focus, and of the user's own company (manager features). */
        tier: yield* query((db) => tierOf(db, organization.id)),
        homeTier: yield* query((db) => tierOf(db, home.id)),
      }
    }),
  ),
)

/**
 * The invitation as seen by the signed-in recipient. Better Auth checks that it is pending, not
 * expired and addressed to this user's email; otherwise the error code explains why.
 */
export const getInvitationFn = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ invitationId: Schema.String })))
  .handler(async ({ data }) => {
    try {
      const invitation = await auth.api.getInvitation({
        query: { id: data.invitationId },
        headers: getRequest().headers,
      })
      return {
        ok: true as const,
        invitation: {
          id: invitation.id,
          organizationName: invitation.organizationName,
          inviterEmail: invitation.inviterEmail,
          email: invitation.email,
          role: invitation.role,
        },
      }
    } catch (error) {
      const code = (error as { body?: { code?: string } }).body?.code ?? 'INVITATION_NOT_FOUND'
      return { ok: false as const, code }
    }
  })
