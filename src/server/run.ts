import { notFound, redirect } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { Cause, Effect, Exit, Option } from 'effect'
import { db } from '#/db'
import { member, organization } from '#/db/schema'
import { auth } from '#/lib/auth'
import { DatabaseError, NoActiveOrganization, Unauthenticated } from './errors'
import { Mailer } from './mail/mailer'
import { mailer } from './mail/provider'
import { query } from './scoped'
import { type AppServices, CurrentOrganization, CurrentUser, Database } from './services'

const getSession = Effect.tryPromise({
  try: () => auth.api.getSession({ headers: getRequest().headers }),
  catch: (cause) => new DatabaseError({ cause }),
})

const loadRequestContext = Effect.gen(function* () {
  const session = yield* getSession
  if (!session) return yield* new Unauthenticated()

  const organizationId = session.session.activeOrganizationId
  if (!organizationId) return yield* new NoActiveOrganization()

  // Re-check membership on every request: the session may point at a company the user was removed from.
  const [membership] = yield* query((db) =>
    db
      .select({ role: member.role, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
      .limit(1),
  )
  if (!membership) return yield* new NoActiveOrganization()

  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    organization: { id: organizationId, name: membership.name, role: membership.role },
  }
})

/** Turns a failed program into what TanStack Start expects a server function to throw. */
function toThrowable(cause: Cause.Cause<unknown>): unknown {
  const error = Cause.findErrorOption(cause)
  if (Option.isSome(error)) {
    const e = error.value as { _tag?: string; message?: string }
    switch (e._tag) {
      case 'Unauthenticated':
        return redirect({ to: '/login' })
      case 'NoActiveOrganization':
        return redirect({ to: '/onboarding' })
      case 'NotFound':
        return notFound()
      case 'Conflict':
        return new Error(e.message)
    }
  }
  console.error(Cause.pretty(cause))
  return new Error('Något gick fel. Försök igen.')
}

/**
 * Runs an Effect program inside a server function handler with the signed-in user, their active
 * company, the database and the mailer provided. Expected failures become redirects or
 * user-facing errors.
 */
export async function runApp<A, E>(program: Effect.Effect<A, E, AppServices>): Promise<A> {
  const exit = await Effect.gen(function* () {
    const context = yield* loadRequestContext
    return yield* program.pipe(
      Effect.provideService(CurrentUser, context.user),
      Effect.provideService(CurrentOrganization, context.organization),
    )
  }).pipe(
    Effect.provideService(Database, db),
    Effect.provideService(Mailer, mailer),
    Effect.runPromiseExit,
  )

  if (Exit.isSuccess(exit)) return exit.value
  throw toThrowable(exit.cause)
}

/** The raw Better Auth session, for routes that run before a company exists (login, onboarding). */
export const getSessionOrNull = () => auth.api.getSession({ headers: getRequest().headers })
