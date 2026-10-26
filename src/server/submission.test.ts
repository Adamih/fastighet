import { Database as Sqlite } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Effect } from 'effect'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import type { Permissions } from '#/lib/permissions'
import { Conflict, DatabaseError } from './errors'
import {
  CurrentOrganization,
  CurrentUser,
  Database,
  PermissionChecker,
  SubmissionReplay,
} from './services'
import { once } from './submission'

const databases: Sqlite[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function harness() {
  const sqlite = new Sqlite(':memory:')
  databases.push(sqlite)
  sqlite.exec(`CREATE TABLE submission (
    organization_id TEXT NOT NULL, user_id TEXT NOT NULL, operation TEXT NOT NULL,
    request_id TEXT NOT NULL, payload TEXT NOT NULL, result TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, user_id, operation, request_id)
  )`)
  const db = drizzle(sqlite, { schema }) as unknown as Db
  const run = <A, E, R>(
    program: Effect.Effect<A, E, R>,
    org = 'org',
    user = 'user',
    allowed = true,
  ) =>
    program.pipe(
      Effect.provideService(Database, db),
      Effect.provideService(CurrentOrganization, {
        id: org,
        name: org,
        role: 'owner',
        grant: null,
      }),
      Effect.provideService(CurrentUser, { id: user, name: user, email: 'test@example.test' }),
      Effect.provideService(PermissionChecker, { check: async () => allowed }),
      // Test programs do not require a mailer or other runtime services.
    ) as Effect.Effect<A, E, never>
  return {
    run: <A, E, R>(...args: Parameters<typeof run<A, E, R>>) => Effect.runPromise(run(...args)),
  }
}
const permission: Permissions = { property: ['manage'] }
const input = { requestId: 'request-1', name: 'example' }

describe('durable submissions', () => {
  test('replays a successful result, preserving dates, without another write', async () => {
    const { run } = harness()
    let writes = 0
    const createdAt = new Date('2026-10-24T12:00:00Z')
    const command = once(
      'create',
      input,
      permission,
      Effect.sync(() => ({ id: ++writes, createdAt })),
    )
    const first = await run(command)
    expect(await run(command)).toEqual(first)
    expect(writes).toBe(1)
    expect(first.createdAt).toBeInstanceOf(Date)
  })

  test('tells runApp about a replay, so the audit log records the write once', async () => {
    const { run } = harness()
    let replays = 0
    const command = once('create', input, permission, Effect.succeed({ id: 1 })).pipe(
      Effect.provideService(SubmissionReplay, {
        mark: () => {
          replays += 1
        },
      }),
    )
    await run(command)
    expect(replays).toBe(0)
    await run(command)
    expect(replays).toBe(1)
  })

  test('a lost response is recovered with the same key', async () => {
    const { run } = harness()
    let writes = 0
    const command = once(
      'create',
      input,
      permission,
      Effect.sync(() => ++writes),
    )
    await run(command) // Response discarded by the client.
    expect(await run(command)).toBe(1)
    expect(writes).toBe(1)
  })

  test('retains an uncertain claim after a database failure', async () => {
    const { run } = harness()
    let writes = 0
    const write = Effect.sync(() => {
      writes++
    }).pipe(Effect.andThen(Effect.fail(new DatabaseError({ cause: 'lost acknowledgement' }))))
    await expect(run(once('create', input, permission, write))).rejects.toMatchObject({
      _tag: 'DatabaseError',
    })
    await expect(run(once('create', input, permission, write))).rejects.toMatchObject({
      _tag: 'UncertainSubmission',
    })
    expect(writes).toBe(1)
  })

  test('a concurrent repeat cannot execute an in-flight command twice', async () => {
    const { run } = harness()
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    let writes = 0
    const command = once(
      'create',
      input,
      permission,
      Effect.promise(async () => {
        writes++
        started()
        await gate
        return 'created'
      }),
    )
    const original = run(command)
    await entered
    try {
      await expect(run(command)).rejects.toMatchObject({ _tag: 'UncertainSubmission' })
      expect(writes).toBe(1)
    } finally {
      release()
    }
    expect(await original).toBe('created')
    expect(await run(command)).toBe('created')
    expect(writes).toBe(1)
  })

  test('a business-rule rejection allows a corrected retry', async () => {
    const { run } = harness()
    await expect(
      run(once('create', input, permission, Effect.fail(new Conflict({ message: 'Occupied' })))),
    ).rejects.toMatchObject({ _tag: 'Conflict' })
    expect(await run(once('create', input, permission, Effect.succeed('created')))).toBe('created')
  })

  test('rejects a reused key with a different payload', async () => {
    const { run } = harness()
    await run(once('create', input, permission, Effect.succeed('created')))
    await expect(
      run(once('create', { ...input, name: 'different' }, permission, Effect.succeed('duplicate'))),
    ).rejects.toMatchObject({ _tag: 'Conflict' })
  })

  test('scopes keys to company, user and operation; checks permissions before replay', async () => {
    const { run } = harness()
    let writes = 0
    const command = (operation = 'create') =>
      once(
        operation,
        input,
        permission,
        Effect.sync(() => ++writes),
      )
    await run(command())
    await run(command(), 'other-org')
    await run(command(), 'org', 'other-user')
    await run(command('different'))
    expect(writes).toBe(4)
    await expect(run(command(), 'org', 'user', false)).rejects.toMatchObject({ _tag: 'Forbidden' })
    expect(writes).toBe(4)
  })
})
