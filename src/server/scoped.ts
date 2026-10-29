import { type AnyColumn, and, eq, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Db } from '#/db'
import { DatabaseError, NotFound } from './errors'
import { CurrentOrganization, Database } from './services'

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
