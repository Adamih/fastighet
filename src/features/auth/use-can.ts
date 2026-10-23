import { useRouteContext } from '@tanstack/react-router'
import { can, type Permissions } from '#/lib/permissions'

/**
 * Permission checks for the signed-in member, for hiding what they may not do. The server
 * enforces the same rules (`requirePermission`), so this is about the UI only.
 */
export function useCan() {
  const { app } = useRouteContext({ from: '/_app' })
  return (permissions: Permissions) => can(app.organization.role, permissions)
}
