import { Effect } from 'effect'
import type { Permissions } from '#/lib/permissions'
import { DatabaseError, Forbidden } from './errors'
import { CurrentOrganization, PermissionChecker } from './services'

/** Ask Better Auth about the authenticated member in the company used by orgQuery. */
export const hasPermission = (permissions: Permissions) =>
  Effect.gen(function* () {
    const organization = yield* CurrentOrganization
    const checker = yield* PermissionChecker
    return yield* Effect.tryPromise({
      try: () => checker.check(organization.id, permissions),
      catch: (cause) => new DatabaseError({ cause }),
    })
  })

/** Domain programs use this Effect adapter; Better Auth evaluates the permissions. */
export const requirePermission = (permissions: Permissions) =>
  Effect.gen(function* () {
    if (!(yield* hasPermission(permissions))) return yield* new Forbidden()
  })
