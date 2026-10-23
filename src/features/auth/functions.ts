import { createServerFn } from '@tanstack/react-start'
import { Effect } from 'effect'
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
