import { notFound, redirect } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { asc, eq } from 'drizzle-orm'
import { Cause, Context, Effect, Exit, Option } from 'effect'
import { db } from '#/db'
import { member, organization, session as sessionTable, user } from '#/db/schema'
import type { Audit } from '#/features/audit/actions'
import { appError } from '#/lib/app-errors'
import { auth } from '#/lib/auth'
import { COMPANY_HEADER, companyFromSearch } from '#/lib/focus'
import { m } from '#/paraglide/messages'
import { inCompany } from '#/server/scoped'
import { recordAudit } from './audit'
import { requireCustomerSession } from './customer-access'
import { DatabaseError, NoActiveOrganization, Unauthenticated } from './errors'
import { customRolesOf, resolveFocus } from './focus'
import { appRuntime } from './live'
import { query } from './scoped'
import {
  type AppServices,
  CurrentOrganization,
  CurrentUser,
  HomeOrganization,
  PermissionCheckError,
  PermissionChecker,
  type RequestServices,
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
          ? inCompany(member, organizationId, eq(member.userId, userId))
          : eq(member.userId, userId),
      )
      .orderBy(asc(member.createdAt))
      .limit(1),
  )

/** The admin behind an impersonated session, for the banner and the audit log. */
const impersonator = (adminId: string | null | undefined) =>
  Effect.gen(function* () {
    if (!adminId) return null
    const [admin] = yield* query((db) =>
      db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, adminId)),
    )
    return admin ?? { id: adminId, name: '' }
  })

const loadRequestContext = Effect.gen(function* () {
  const session = yield* getSession
  if (!session) return yield* new Unauthenticated()

  // Staff never enter a customer company under their own account, even with a membership.
  yield* requireCustomerSession(session)

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

  const home = {
    id: membership.organizationId,
    name: membership.name,
    role: membership.role,
    customRoles: yield* customRolesOf(membership.organizationId),
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      impersonatedBy: yield* impersonator(session.session.impersonatedBy),
    },
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
export function toThrowable(cause: Cause.Cause<unknown>): unknown {
  const error = Cause.findErrorOption(cause)
  if (Option.isSome(error)) {
    const e = error.value as { _tag?: string; message?: string }
    switch (e._tag) {
      case 'Unauthenticated':
        return redirect({ to: '/login' })
      case 'AdminOnly':
        return redirect({ to: '/admin' })
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

/** Better Auth's permission API, answering for this request's session. */
const permissionChecker = (headers: Headers): PermissionChecker['Service'] => ({
  check: (organizationId, permissions) =>
    Effect.tryPromise({
      try: () => auth.api.hasPermission({ headers, body: { organizationId, permissions } }),
      catch: (cause) => new PermissionCheckError({ cause }),
    }).pipe(Effect.map((result) => result.success)),
})

type RequestContext = Effect.Success<typeof loadRequestContext>

/** The request-scoped services, from the request's user and company in focus. */
const requestServices = (context: RequestContext): Context.Context<RequestServices> =>
  Context.make(CurrentUser, context.user).pipe(
    Context.add(CurrentOrganization, context.organization),
    Context.add(HomeOrganization, context.home),
    Context.add(PermissionChecker, permissionChecker(getRequest().headers)),
  )

/**
 * Runs an Effect program inside a server function handler with the signed-in user, the company
 * in focus (their own, or one their company manages) and the app's services (`AppLive`) provided.
 * Expected failures become redirects or user-facing errors.
 */
export async function runApp<A, E>(
  program: Effect.Effect<A, E, AppServices>,
  /** For writes: what to record in the company's audit log once the program succeeds. */
  audit?: Audit,
): Promise<A> {
  const exit = await appRuntime.runPromiseExit(
    Effect.gen(function* () {
      const context = yield* loadRequestContext
      let replayed = false
      const result = yield* program.pipe(
        Effect.provideService(SubmissionReplay, {
          mark: () => {
            replayed = true
          },
        }),
        Effect.provideContext(requestServices(context)),
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
    }),
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
