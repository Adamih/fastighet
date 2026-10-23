import { env } from 'cloudflare:workers'
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export type Db = DrizzleD1Database<typeof schema>

export const db: Db = drizzle(env.DB, { schema })
