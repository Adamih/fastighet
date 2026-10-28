// Entry point for `bun run auth:generate`. The CLI only reads the config to emit the schema,
// so the database handle, Stripe and the email and audit hooks are never used.
import { drizzle } from 'drizzle-orm/d1'
import Stripe from 'stripe'
import * as schema from '#/db/schema'
import { createAuth } from '#/lib/auth-config'

export const auth = createAuth(drizzle({} as D1Database, { schema }), {
  deliverEmail: () => {},
  recordCompanyEvent: async () => {},
  stripe: { client: new Stripe('sk_test_cli'), webhookSecret: '' },
  syncQuantity: async () => {},
})
