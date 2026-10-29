import { useRouteContext } from '@tanstack/react-router'
import { managedAllows } from '#/lib/managed-access'
import { type Permissions, roleAllows } from '#/lib/permissions'

/**
 * Permission checks for the signed-in user in the company in focus, for hiding what they may not
 * do. The server enforces the same rules (`requirePermission`), so this is about the UI only.
 */
export function useCan() {
  const { app } = useRouteContext({ from: '/_app' })
  const { grant, role, customRoles } = app.organization
  // The same rules as the server: Better Auth's roles and the company's custom roles at home
  // (`checkRolePermission` can't see custom roles), capped by the grant in a managed company.
  return (permissions: Permissions) =>
    grant
      ? managedAllows(role, grant, permissions, customRoles)
      : roleAllows(role, permissions, customRoles)
}

/** Whether the company in focus is the user's own (not one their company manages). */
export function useIsOwnCompany() {
  const { app } = useRouteContext({ from: '/_app' })
  return app.organization.grant === null
}
