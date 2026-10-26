import { useRouteContext } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import { managedAllows } from '#/lib/managed-access'
import type { Permissions, roles } from '#/lib/permissions'

/**
 * Permission checks for the signed-in user in the company in focus, for hiding what they may not
 * do. The server enforces the same rules (`requirePermission`), so this is about the UI only.
 */
export function useCan() {
  const { app } = useRouteContext({ from: '/_app' })
  const { grant, role } = app.organization
  return (permissions: Permissions) =>
    grant
      ? managedAllows(role, grant, permissions)
      : authClient.organization.checkRolePermission({
          // Better Auth also accepts comma-separated memberships at runtime.
          role: role as keyof typeof roles,
          permissions,
        })
}

/** Whether the company in focus is the user's own (not one their company manages). */
export function useIsOwnCompany() {
  const { app } = useRouteContext({ from: '/_app' })
  return app.organization.grant === null
}
