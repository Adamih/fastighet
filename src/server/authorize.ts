import { Effect } from 'effect'
import { Forbidden } from './errors'
import { CurrentOrganization } from './services'

/** Fails with `Forbidden` unless the current user is an owner or admin of the company. */
export const requireManager = Effect.gen(function* () {
  const { role } = yield* CurrentOrganization
  if (role !== 'owner' && role !== 'admin') return yield* new Forbidden()
})
