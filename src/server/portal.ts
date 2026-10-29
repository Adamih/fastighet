import { redirect } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { Cause, Effect, Exit, Option } from 'effect'
import type { Audit } from '#/features/audit/actions'
import { tierOf } from '#/features/billing/store'
import { portalCompaniesOf } from '#/features/portal/companies'
import { auth } from '#/lib/auth'
import { sessionWorkspace } from '#/lib/workspace'
import { recordPortalAudit } from './audit'
import { CompanyNotInScope, DatabaseError, NoPortalAccess, WrongWorkspace } from './errors'
import { appRuntime } from './live'
import { impersonator, requestedCompany, toThrowable } from './run'
import { query } from './scoped'
import { PortalCompany, type PortalServices, PortalUser, type ProcessServices } from './services'

// Runners for Mina sidor (`features/portal`). Portal users are never company members, so portal
// programs never run through `runApp`: `runPortal` provides the person and the company in focus
// with their parties there, from their `party_access` links.

/** For the portal's public pages (accepting an invitation): no session or company needed. */
export async function runPortalPublic<A, E>(
  program: Effect.Effect<A, E, ProcessServices>,
): Promise<A> {
  const exit = await appRuntime.runPromiseExit(program)
  if (Exit.isSuccess(exit)) return exit.value
  throw toThrowable(exit.cause)
}

/** The person signed in to Mina sidor and the companies they reach; fails outside the portal. */
export const loadPortalContext = Effect.gen(function* () {
  const session = yield* Effect.tryPromise({
    try: () => auth.api.getSession({ headers: getRequest().headers }),
    catch: (cause) => new DatabaseError({ cause }),
  })
  // Not signed in, or signed in to the app: the portal's login page, which explains.
  if (!session || sessionWorkspace(session.session) !== 'portal') {
    return yield* new WrongWorkspace({ wanted: 'portal' })
  }
  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    impersonatedBy: yield* impersonator(session.session.impersonatedBy),
  }
  const companies = yield* portalCompaniesOf(user.id)
  return { user, companies }
})

/** The company asked for (`?company=`), else the first; fails when it isn't the person's. */
export const focusPortalCompany = (
  companies: Effect.Success<typeof loadPortalContext>['companies'],
  requested: string | null,
) =>
  Effect.gen(function* () {
    if (companies.length === 0) return yield* new NoPortalAccess()
    const company = requested ? companies.find((c) => c.id === requested) : companies[0]
    if (!company) return yield* new CompanyNotInScope()
    return {
      id: company.id,
      name: company.name,
      kind: company.kind,
      parties: company.parties,
      partyIds: company.parties.map((p) => p.id),
      tier: yield* query((db) => tierOf(db, company.id)),
    }
  })

/** A write from Mina sidor and the party it was done as, for the company's audit log. */
export type PortalAudit = Audit & { readonly partyId: string }

/** In the portal, a company outside the person's scope sends them to the portal's start. */
function toPortalThrowable(cause: Cause.Cause<unknown>): unknown {
  const error = Cause.findErrorOption(cause)
  if (Option.isSome(error) && error.value instanceof CompanyNotInScope) {
    return redirect({ href: '/portal' })
  }
  return toThrowable(cause)
}

/**
 * Runs a portal program with the person and the company in focus provided. Writes pass their
 * action and the party acted as, recorded in the company's audit log once the program succeeds.
 */
export async function runPortal<A, E>(
  program: Effect.Effect<A, E, PortalServices>,
  /** What to record; from the result when it names the party (e.g. an extract). */
  audit?: PortalAudit | ((result: A) => PortalAudit),
): Promise<A> {
  const exit = await appRuntime.runPromiseExit(
    Effect.gen(function* () {
      const context = yield* loadPortalContext
      const company = yield* focusPortalCompany(context.companies, requestedCompany())
      const result = yield* program.pipe(
        Effect.provideService(PortalUser, context.user),
        Effect.provideService(PortalCompany, company),
      )
      if (audit) {
        const entry = typeof audit === 'function' ? audit(result) : audit
        const party = company.parties.find((p) => p.id === entry.partyId)
        if (party) {
          yield* recordPortalAudit(
            { organizationId: company.id, user: context.user, party },
            entry,
            result,
          )
        }
      }
      return result
    }),
  )
  if (Exit.isSuccess(exit)) return exit.value
  throw toPortalThrowable(exit.cause)
}

/**
 * Mina sidor's layout context: the person, the companies they reach and the company in focus
 * (null when they no longer have access anywhere, which the layout explains).
 */
export async function portalContext() {
  const exit = await appRuntime.runPromiseExit(
    Effect.gen(function* () {
      const context = yield* loadPortalContext
      const company =
        context.companies.length === 0
          ? null
          : yield* focusPortalCompany(context.companies, requestedCompany())
      return {
        user: context.user,
        companies: context.companies.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
        company,
      }
    }),
  )
  if (Exit.isSuccess(exit)) return exit.value
  throw toPortalThrowable(exit.cause)
}
