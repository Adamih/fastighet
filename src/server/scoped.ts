import { Effect } from 'effect'
import type { Db } from '#/db'
import { DatabaseError } from './errors'
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
 * every read and write of a domain table goes through here and must filter on `organizationId`.
 */
export const orgQuery = <A>(run: (db: Db, organizationId: string) => Promise<A>) =>
  Effect.gen(function* () {
    const organization = yield* CurrentOrganization
    return yield* query((db) => run(db, organization.id))
  })
