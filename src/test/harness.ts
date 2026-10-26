import { Database as Sqlite } from 'bun:sqlite'
import { afterEach } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Effect } from 'effect'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import { CurrentOrganization, CurrentUser, Database, PermissionChecker } from '#/server/services'

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
  const dir = 'drizzle'
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    for (const statement of readFileSync(`${dir}/${file}`, 'utf8').split(
      '--> statement-breakpoint',
    )) {
      const sql = statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
      if (sql) sqlite.exec(sql)
    }
  }
  const db = drizzle(sqlite, { schema })
  Object.assign(db, {
    batch: async (statements: { run: () => unknown }[]) =>
      sqlite.transaction(() => statements.map((s) => s.run()))(),
  })
  const run = <A, E, R>(program: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      program.pipe(
        Effect.provideService(Database, db as unknown as Db),
        Effect.provideService(CurrentOrganization, { id: 'org', name: 'Test', role: 'owner' }),
        Effect.provideService(CurrentUser, { id: 'user', name: 'u', email: 'u@example.test' }),
        Effect.provideService(PermissionChecker, { check: async () => true }),
      ) as Effect.Effect<A, E, never>,
    )
  const now = Date.now()
  sqlite.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('org', 'Test', 'test', ${now});
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('user', 'u', 'u@example.test', 1, ${now}, ${now});
    INSERT INTO organization_settings (organization_id, bankgiro) VALUES ('org', '990-0002');
    INSERT INTO property (id, organization_id, designation) VALUES ('p', 'org', 'Uppsala 1:1');
    INSERT INTO unit (id, organization_id, property_id, kind, label) VALUES
      ('u1', 'org', 'p', 'apartment', '1001'), ('f1', 'org', 'p', 'storage', 'F1'),
      ('p1', 'org', 'p', 'parking', 'P1');
    INSERT INTO party (id, organization_id, kind, name) VALUES
      ('anna', 'org', 'person', 'Anna'), ('erik', 'org', 'person', 'Erik'),
      ('maja', 'org', 'person', 'Maja');
  `)
  return { run, sqlite }
}

/** The failure message of a program that should fail. */
export const fail = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a failure')
    },
    (error: unknown) => String(error),
  )
