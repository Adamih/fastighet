import { getRequest } from '@tanstack/react-start/server'
import { Effect, Exit } from 'effect'
import { db } from '#/db'
import { auth } from '#/lib/auth'
import { DatabaseError, NotFound, Unauthenticated } from './errors'
import { toThrowable } from './run'
import { AdminAuth, AdminUser, Database } from './services'

// Runs the admin dashboard's programs. Separate from `runApp`: no company is in focus, and the
// signed-in user must be an admin (Better Auth's admin plugin, `user.role`) who isn't acting as
// someone else. Anyone else gets a 404, so the dashboard doesn't reveal itself.

const isAdminRole = (role: string | null | undefined) => (role ?? '').split(',').includes('admin')

/** Whether the request's user may use the admin dashboard; null when not signed in. */
export async function adminOfRequest() {
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) return null
  const user = session.user as typeof session.user & { role?: string | null }
  const impersonatedBy = (session.session as { impersonatedBy?: string | null }).impersonatedBy
  return {
    user: { id: user.id, name: user.name, email: user.email },
    admin: isAdminRole(user.role) && !impersonatedBy,
  }
}

const loadAdmin = Effect.gen(function* () {
  const found = yield* Effect.tryPromise({
    try: adminOfRequest,
    catch: (cause) => new DatabaseError({ cause }),
  })
  if (!found) return yield* new Unauthenticated()
  if (!found.admin) return yield* new NotFound({ entity: 'page', id: 'admin' })
  return found.user
})

const adminAuth = (headers: Headers): AdminAuth['Service'] => ({
  ban: async (userId, reason, expiresInSeconds) => {
    await auth.api.banUser({
      headers,
      body: { userId, banReason: reason, banExpiresIn: expiresInSeconds ?? undefined },
    })
  },
  unban: async (userId) => {
    await auth.api.unbanUser({ headers, body: { userId } })
  },
  setAdmin: async (userId, admin) => {
    await auth.api.setRole({ headers, body: { userId, role: admin ? 'admin' : 'user' } })
  },
  revokeSessions: async (userId) => {
    await auth.api.revokeUserSessions({ headers, body: { userId } })
  },
})

export async function runAdmin<A, E>(
  program: Effect.Effect<A, E, Database | AdminUser | AdminAuth>,
): Promise<A> {
  const headers = getRequest().headers
  const exit = await Effect.gen(function* () {
    const admin = yield* loadAdmin
    return yield* program.pipe(
      Effect.provideService(AdminUser, admin),
      Effect.provideService(AdminAuth, adminAuth(headers)),
    )
  }).pipe(Effect.provideService(Database, db), Effect.runPromiseExit)
  if (Exit.isSuccess(exit)) return exit.value
  throw toThrowable(exit.cause)
}
