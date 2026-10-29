import { type AnyColumn, and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Db } from '#/db'
import { DatabaseError, NotFound } from './errors'
import { CurrentOrganization, Database, PortalCompany } from './services'

/** Runs a Drizzle query, turning rejections into a typed `DatabaseError`. */
export const query = <A>(run: (db: Db) => Promise<A>) =>
  Effect.gen(function* () {
    const db = yield* Database
    return yield* Effect.tryPromise({
      try: () => run(db),
      catch: (cause) => new DatabaseError({ cause }),
    })
  })

/**
 * Like `query`, but hands over the current company's id. SQLite has no row-level security, so
 * every read and write of a domain table goes through here and filters with `inCompany`.
 */
export const orgQuery = <A>(run: (db: Db, organizationId: string) => Promise<A>) =>
  Effect.gen(function* () {
    const organization = yield* CurrentOrganization
    return yield* query((db) => run(db, organization.id))
  })

/**
 * The company filter for a domain table, with any further conditions: the one way programs
 * filter on `organizationId`, so a query without it stands out in review.
 */
export const inCompany = (
  table: { readonly organizationId: AnyColumn },
  organizationId: string,
  ...conditions: (SQL | undefined)[]
): SQL => and(eq(table.organizationId, organizationId), ...conditions) as SQL

/** Fails with `NotFound` when a lookup found nothing: `orgQuery(…).pipe(orNotFound('invoice', id))`. */
export const orNotFound =
  (entity: string, id: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<NonNullable<A>, E | NotFound, R> =>
    Effect.flatMap(self, (row) =>
      row === null || row === undefined
        ? Effect.fail(new NotFound({ entity, id }))
        : Effect.succeed(row as NonNullable<A>),
    )

/** The company in focus in Mina sidor and the signed-in person's parties there. */
export interface PortalScope {
  readonly organizationId: string
  readonly partyIds: readonly string[]
}

/**
 * Like `orgQuery`, for Mina sidor: hands over the company in focus and the person's parties
 * there. Portal programs read through here and filter with `inParties` (or reach rows through
 * the agreements those parties are on), never with `inCompany` alone.
 */
export const portalQuery = <A>(run: (db: Db, scope: PortalScope) => Promise<A>) =>
  Effect.gen(function* () {
    const company = yield* PortalCompany
    return yield* query((db) => run(db, { organizationId: company.id, partyIds: company.partyIds }))
  })

/** A domain table's rows of the person's parties in the company in focus. */
export const inParties = (
  table: { readonly organizationId: AnyColumn; readonly partyId: AnyColumn },
  scope: PortalScope,
  ...conditions: (SQL | undefined)[]
): SQL =>
  inCompany(
    table,
    scope.organizationId,
    // No parties: nothing, rather than an empty IN list.
    scope.partyIds.length > 0 ? inArray(table.partyId, [...scope.partyIds]) : sql`0`,
    ...conditions,
  )
