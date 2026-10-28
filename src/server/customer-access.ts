import { Effect } from 'effect'
import { AdminOnly } from './errors'

/** Staff enter customer data only through an impersonated customer session. */
export const requireCustomerSession = (session: {
  user: { role?: string | null }
  session: { impersonatedBy?: string | null }
}): Effect.Effect<void, AdminOnly> =>
  (session.user.role ?? '').split(',').includes('admin') && !session.session.impersonatedBy
    ? Effect.fail(new AdminOnly())
    : Effect.void
