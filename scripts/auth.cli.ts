// Entry point for `bun run auth:generate`. The CLI only reads the config to emit the schema,
// so the database handle and the email hook are never used.
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '#/db/schema'
import { createAuth } from '#/lib/auth-config'

export const auth = createAuth(drizzle({} as D1Database, { schema }), { deliverEmail: () => {} })
