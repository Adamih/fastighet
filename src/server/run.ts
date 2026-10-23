import { notFound, redirect } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { and, asc, eq } from 'drizzle-orm'
import { Cause, Effect, Exit, Option } from 'effect'
import { db } from '#/db'
import { member, organization, session as sessionTable } from '#/db/schema'
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

const membershipQuery = (userId: string, organizationId?: string) =>
  query((db) =>
    db
      .select({ organizationId: member.organizationId, role: member.role, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        organizationId
          ? and(eq(member.userId, userId), eq(member.organizationId, organizationId))
          : eq(member.userId, userId),
      )
      .orderBy(asc(member.createdAt))
      .limit(1),
  )

const loadRequestContext = Effect.gen(function* () {
  const session = yield* getSession
  if (!session) return yield* new Unauthenticated()

  // Re-check membership on every request: the session may point at a company the user was
  // removed from. Then fall back to their oldest remaining company and remember it on the session.
  const activeId = session.session.activeOrganizationId
  let [membership] = activeId ? yield* membershipQuery(session.user.id, activeId) : []
  if (!membership) {
    ;[membership] = yield* membershipQuery(session.user.id)
    if (!membership) return yield* new NoActiveOrganization()
    const organizationId = membership.organizationId
    yield* query((db) =>
      db
        .update(sessionTable)
        .set({ activeOrganizationId: organizationId })
        .where(eq(sessionTable.id, session.session.id)),
    )
  }

  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    organization: { id: membership.organizationId, name: membership.name, role: membership.role },
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
      case 'Forbidden':
        return new Error('Du har inte behörighet att göra det här.')
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

/** Whether the user belongs to any company, regardless of which one the session points at. */
export async function hasAnyMembership(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)
  return row !== undefined
}
