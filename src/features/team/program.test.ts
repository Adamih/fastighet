/// <reference types="bun" />
import { Database as Sqlite } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Effect, Schema } from 'effect'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import { CurrentOrganization, CurrentUser, Database } from '#/server/services'
import { removeMember, updateMemberRole } from './program'
import { UpdateMemberRoleInput } from './schemas'

function fixture(actorRole = 'admin', targetRole = 'owner') {
  const sqlite = new Sqlite(':memory:')
  sqlite.run(`CREATE TABLE member (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, created_at INTEGER NOT NULL
  )`)
  const insert = sqlite.prepare('INSERT INTO member VALUES (?, ?, ?, ?, 0)')
  insert.run('self', 'company', 'actor', actorRole)
  insert.run('target', 'company', 'other', targetRole)
  insert.run('foreign', 'another-company', 'outsider', 'owner')
  // The test uses SQLite directly; production uses the same schema through D1.
  const db = drizzle(sqlite, { schema }) as unknown as Db
  const run = <A, E>(program: Effect.Effect<A, E, Database | CurrentUser | CurrentOrganization>) =>
    Effect.runPromise(
      program.pipe(
        Effect.provideService(Database, db),
        Effect.provideService(CurrentUser, { id: 'actor', name: 'Actor', email: 'a@example.se' }),
        Effect.provideService(CurrentOrganization, {
          id: 'company',
          name: 'Company',
          role: actorRole,
        }),
      ),
    )
  const rows = () => sqlite.query('SELECT id, role FROM member ORDER BY id').all()
  return { sqlite, run, rows }
}

describe('permission-based member management', () => {
  test.each([
    'owner',
    'owner,admin',
    'member, owner',
  ])('an admin can demote the only owner (%p) and grant ownership', async (targetRole) => {
    const f = fixture('admin', targetRole)
    try {
      await f.run(updateMemberRole({ memberId: 'target', role: 'member' }))
      expect(f.rows()).toContainEqual({ id: 'target', role: 'member' })
      await f.run(updateMemberRole({ memberId: 'target', role: 'owner' }))
      expect(f.rows()).toContainEqual({ id: 'target', role: 'owner' })
    } finally {
      f.sqlite.close()
    }
  })

  test.each(['admin', 'member, admin'])('%p can remove the only owner', async (actorRole) => {
    const f = fixture(actorRole)
    try {
      await f.run(removeMember('target'))
      expect(f.rows()).toEqual([
        { id: 'foreign', role: 'owner' },
        { id: 'self', role: actorRole },
      ])
    } finally {
      f.sqlite.close()
    }
  })

  test.each([
    'update',
    'remove',
  ])('%p rejects missing permissions, self-actions and targets outside the company', async (action) => {
    for (const [actorRole, targetId, error] of [
      ['member', 'target', 'Forbidden'],
      ['admin', 'self', 'Forbidden'],
      ['admin', 'foreign', 'NotFound'],
      ['admin', 'missing', 'NotFound'],
    ]) {
      const f = fixture(actorRole)
      try {
        const before = f.rows()
        const program =
          action === 'update'
            ? updateMemberRole({ memberId: targetId, role: 'admin' })
            : removeMember(targetId)
        await expect(f.run(program)).rejects.toMatchObject({ _tag: error })
        expect(f.rows()).toEqual(before)
      } finally {
        f.sqlite.close()
      }
    }
  })

  test('the server input rejects unknown and combined role assignments', async () => {
    for (const role of ['guest', 'owner,admin', '']) {
      await expect(
        Effect.runPromise(
          Schema.decodeUnknownEffect(UpdateMemberRoleInput)({ memberId: 'target', role }),
        ),
      ).rejects.toBeDefined()
    }
  })
})
