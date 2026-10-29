import { Database as Sqlite } from 'bun:sqlite'
import { afterEach } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { Effect } from 'effect'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import type { Grant } from '#/lib/managed-access'
import type { CustomRoles } from '#/lib/permissions'
import { Mailer } from '#/server/mail/mailer'
import { makeMockMailer } from '#/server/mail/mock'
import {
  Billing,
  CurrentOrganization,
  CurrentUser,
  Database,
  HomeOrganization,
  KpiSource,
  PermissionChecker,
} from '#/server/services'

// Test helper: runs programs against an in-memory SQLite database with every migration applied
// and a small fixture company ('org', with a bankgiro, and its user 'user'): one property, an apartment (u1), a storage unit (f1), a
// parking space (p1) and three people (anna, erik, maja). Bun's SQLite driver has no `batch`,
// so a batch runs in one transaction, which is what D1 does.

const databases: Sqlite[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

export function harness() {
  const sqlite = new Sqlite(':memory:')
  databases.push(sqlite)
  sqlite.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: 'drizzle' })
  Object.assign(db, {
    batch: async (statements: { run: () => unknown }[]) =>
      sqlite.transaction(() => statements.map((s) => s.run()))(),
  })
  // Sent emails land in `outbox` instead of being delivered.
  const { mailer, outbox } = makeMockMailer({ from: 'Test <no-reply@example.test>' })
  // New KPI months "from SCB": tests push to it before a program syncs.
  const kpiFeed: { month: string; valueHundredths: number }[] = []
  // Companies whose subscription quantity a program asked to sync, instead of calling Stripe.
  const quantitySyncs: string[] = []
  // `runAs` runs as someone else, e.g. a manager's staff in a company their company manages.
  const runAs =
    (as: {
      user?: string
      home?: { id: string; name: string; role: string; customRoles?: CustomRoles }
      organization?: {
        id: string
        name: string
        role: string
        grant: Grant | null
        customRoles?: CustomRoles
      }
    }) =>
    <A, E, R>(program: Effect.Effect<A, E, R>) => {
      const home = { customRoles: {}, ...(as.home ?? { id: 'org', name: 'Test', role: 'owner' }) }
      const user = as.user ?? 'user'
      return Effect.runPromise(
        program.pipe(
          Effect.provideService(Database, db as unknown as Db),
          Effect.provideService(
            CurrentOrganization,
            as.organization
              ? { customRoles: home.customRoles, ...as.organization }
              : { ...home, grant: null },
          ),
          Effect.provideService(HomeOrganization, home),
          Effect.provideService(
            CurrentUser,
            as.user
              ? { id: user, name: user, email: `${user}@example.test` }
              : { id: 'user', name: 'u', email: 'u@example.test' },
          ),
          Effect.provideService(PermissionChecker, { check: async () => true }),
          Effect.provideService(Mailer, mailer),
          Effect.provideService(KpiSource, { fetch: async () => kpiFeed }),
          Effect.provideService(Billing, {
            configured: false,
            syncQuantity: async (organizationId) => {
              quantitySyncs.push(organizationId)
            },
          }),
        ) as Effect.Effect<A, E, never>,
      )
    }
  const run = runAs({})
  const now = Date.now()
  sqlite.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('org', 'Test', 'test', ${now});
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('user', 'u', 'u@example.test', 1, ${now}, ${now});
    -- Tests run on the top tier unless they test the tiers.
    INSERT INTO organization_settings (organization_id, bankgiro, plan_override)
      VALUES ('org', '990-0002', 'landlord_pro');
    INSERT INTO property (id, organization_id, designation) VALUES ('p', 'org', 'Uppsala 1:1');
    INSERT INTO unit (id, organization_id, property_id, kind, label) VALUES
      ('u1', 'org', 'p', 'apartment', '1001'), ('f1', 'org', 'p', 'storage', 'F1'),
      ('p1', 'org', 'p', 'parking', 'P1');
    INSERT INTO party (id, organization_id, kind, name) VALUES
      ('anna', 'org', 'person', 'Anna'), ('erik', 'org', 'person', 'Erik'),
      ('maja', 'org', 'person', 'Maja');
  `)
  return { run, runAs, sqlite, outbox, kpiFeed, quantitySyncs }
}

/** The failure message of a program that should fail. */
export const fail = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a failure')
    },
    (error: unknown) => String(error),
  )
