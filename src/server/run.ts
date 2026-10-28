import { notFound, redirect } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { and, asc, eq } from 'drizzle-orm'
import { Cause, Effect, Exit, Option } from 'effect'
import { db } from '#/db'
import { member, organization, session as sessionTable } from '#/db/schema'
import type { Audit } from '#/features/audit/actions'
import { syncQuantity } from '#/features/billing/store'
import { fetchKpiFromScb } from '#/features/indexation/scb'
import { appError } from '#/lib/app-errors'
import { auth } from '#/lib/auth'
import { COMPANY_HEADER, companyFromSearch } from '#/lib/focus'
import { stripe, stripeConfigured } from '#/lib/stripe'
import { m } from '#/paraglide/messages'
import { recordAudit } from './audit'
import { DatabaseError, NoActiveOrganization, Unauthenticated } from './errors'
import { resolveFocus } from './focus'
import { Mailer } from './mail/mailer'
import { mailer } from './mail/provider'
import { query } from './scoped'
import {
  type AppServices,
  Billing,
  CurrentOrganization,
  CurrentUser,
  Database,
  HomeOrganization,
  KpiSource,
  PermissionChecker,
  SubmissionReplay,
} from './services'

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

  const home = { id: membership.organizationId, name: membership.name, role: membership.role }
  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    home,
    organization: yield* resolveFocus(session.user.id, home, requestedCompany()),
  }
})

/** The company the browser is looking at: the header from `src/start.ts`, or during SSR the URL. */
function requestedCompany(): string | null {
  const request = getRequest()
  return request.headers.get(COMPANY_HEADER) || companyFromSearch(new URL(request.url).search)
}

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
      case 'CompanyNotInScope':
        // Back to the user's own company; the explicit undefined stops the router keeping it.
        return redirect({ to: '/', search: { company: undefined } })
      case 'NotFound':
        return notFound()
      case 'UncertainSubmission':
        return appError('uncertain', m.form_error_uncertain())
      case 'Forbidden':
        return appError('forbidden', m.form_error_forbidden())
      case 'Conflict':
        return appError('conflict', e.message ?? 'Åtgärden kunde inte genomföras.')
    }
  }
  console.error(Cause.pretty(cause))
  return appError('unexpected', m.form_error_unexpected())
}

/**
 * Runs an Effect program inside a server function handler with the signed-in user, the company
 * in focus (their own, or one their company manages), the database and the mailer provided. Expected failures become redirects or
 * user-facing errors.
 */
export async function runApp<A, E>(
  program: Effect.Effect<A, E, AppServices>,
  /** For writes: what to record in the company's audit log once the program succeeds. */
  audit?: Audit,
): Promise<A> {
  const exit = await Effect.gen(function* () {
    const context = yield* loadRequestContext
    let replayed = false
    const result = yield* program.pipe(
      Effect.provideService(SubmissionReplay, {
        mark: () => {
          replayed = true
        },
      }),
      Effect.provideService(CurrentUser, context.user),
      Effect.provideService(CurrentOrganization, context.organization),
      Effect.provideService(HomeOrganization, context.home),
      Effect.provideService(PermissionChecker, {
        check: async (organizationId, permissions) => {
          const result = await auth.api.hasPermission({
            headers: getRequest().headers,
            body: { organizationId, permissions },
          })
          return result.success
        },
      }),
    )
    if (audit && !replayed) {
      yield* recordAudit(
        {
          organizationId: context.organization.id,
          user: context.user,
          actor: context.home,
        },
        audit,
        result,
      )
    }
    return result
  }).pipe(
    Effect.provideService(Database, db),
    Effect.provideService(Mailer, mailer),
    Effect.provideService(KpiSource, { fetch: fetchKpiFromScb }),
    Effect.provideService(Billing, {
      configured: stripeConfigured,
      syncQuantity: (organizationId) => syncQuantity(db, stripe, organizationId),
    }),
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
