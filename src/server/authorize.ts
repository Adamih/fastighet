import { Effect } from 'effect'
import { managedAllows } from '#/lib/managed-access'
import type { Permissions } from '#/lib/permissions'
import { DatabaseError, Forbidden } from './errors'
import { CurrentOrganization, PermissionChecker } from './services'

/**
 * Whether the user may do this in the company used by orgQuery. In their own company Better Auth
 * evaluates their membership; in a managed company the role that applies there is capped by the
 * company's grant (`managedAllows`), without any membership.
 */
export const hasPermission = (permissions: Permissions) =>
  Effect.gen(function* () {
    const organization = yield* CurrentOrganization
    if (organization.grant) {
      return managedAllows(
        organization.role,
        organization.grant,
        permissions,
        organization.customRoles,
      )
    }
    const checker = yield* PermissionChecker
    return yield* Effect.tryPromise({
      try: () => checker.check(organization.id, permissions),
      catch: (cause) => new DatabaseError({ cause }),
    })
  })

/** Domain programs use this Effect adapter; see `hasPermission`. */
export const requirePermission = (permissions: Permissions) =>
  Effect.gen(function* () {
    if (!(yield* hasPermission(permissions))) return yield* new Forbidden()
  })

/**
 * For what only the company's own members do: its team, and managing who manages it or whom it
 * manages. Fails in a company the user reaches through a grant.
 */
export const requireOwnCompany = Effect.gen(function* () {
  if ((yield* CurrentOrganization).grant) return yield* new Forbidden()
})
