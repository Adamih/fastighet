import { Effect } from 'effect'
import { can, type Permissions } from '#/lib/permissions'
import { Forbidden } from './errors'
import { CurrentOrganization } from './services'

/**
 * Fails with `Forbidden` unless the current member's role grants every permission asked for.
 * Start every program that reads or changes company data with one of these.
 */
export const requirePermission = (permissions: Permissions) =>
  Effect.gen(function* () {
    const { role } = yield* CurrentOrganization
    if (!can(role, permissions)) return yield* new Forbidden()
  })

/** Whether the current member holds the permissions, for programs that adapt what they return. */
export const hasPermission = (permissions: Permissions) =>
  Effect.gen(function* () {
    const { role } = yield* CurrentOrganization
    return can(role, permissions)
  })
