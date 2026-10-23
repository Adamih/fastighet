import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Effect, Schema } from 'effect'
import { auth } from '#/lib/auth'
import { getSessionOrNull, runApp } from '#/server/run'
import { CurrentOrganization, CurrentUser } from '#/server/services'

/** Session summary for the login and onboarding routes, which run before a company exists. */
export const getSessionFn = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSessionOrNull()
  if (!session) return null
  return {
    userId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
  }
})

/** Signed-in user plus their active company; redirects to /login or /onboarding otherwise. */
export const getAppContextFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(Effect.all({ user: CurrentUser, organization: CurrentOrganization })),
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
