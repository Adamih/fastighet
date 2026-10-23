import { useRouteContext } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import type { Permissions, roles } from '#/lib/permissions'

/**
 * Permission checks for the signed-in member, for hiding what they may not do. The server
 * enforces the same rules (`requirePermission`), so this is about the UI only.
 */
export function useCan() {
  const { app } = useRouteContext({ from: '/_app' })
  return (permissions: Permissions) =>
    authClient.organization.checkRolePermission({
      // Better Auth also accepts comma-separated memberships at runtime.
      role: app.organization.role as keyof typeof roles,
      permissions,
    })
}
