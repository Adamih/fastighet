import { Database as Sqlite } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Effect } from 'effect'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import { changeBaseCharge } from '#/features/agreements/program'
import { CurrentOrganization, CurrentUser, Database, PermissionChecker } from '#/server/services'
import { createOwnership, deleteOwnership, getOwnership, transferOwnership } from './program'

// Runs the bostadsrätt programs against an in-memory SQLite database with every migration
// applied. Bun's SQLite driver has no `batch`, so the test runs a batch in one transaction, which
// is what D1 does.

const databases: Sqlite[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function harness() {
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
        Effect.provideService(CurrentOrganization, { id: 'org', name: 'Brf', role: 'owner' }),
        Effect.provideService(CurrentUser, { id: 'user', name: 'u', email: 'u@example.test' }),
        Effect.provideService(PermissionChecker, { check: async () => true }),
      ) as Effect.Effect<A, E, never>,
    )
  const now = Date.now()
  sqlite.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('org', 'Brf', 'brf', ${now});
    INSERT INTO property (id, organization_id, designation) VALUES ('p', 'org', 'Uppsala 1:1');
    INSERT INTO unit (id, organization_id, property_id, kind, label) VALUES
      ('u1', 'org', 'p', 'apartment', '1001'), ('f1', 'org', 'p', 'storage', 'F1');
    INSERT INTO party (id, organization_id, kind, name) VALUES
      ('anna', 'org', 'person', 'Anna'), ('erik', 'org', 'person', 'Erik'),
      ('maja', 'org', 'person', 'Maja');
  `)
  return { run, sqlite }
}

const fail = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a failure')
    },
    (error: unknown) => String(error),
  )

const ownership = {
  owners: [
    { partyId: 'anna', sharePercent: 50 },
    { partyId: 'erik', sharePercent: 50 },
  ],
  invoiceRecipientId: 'erik',
  unitIds: ['u1', 'f1'],
  startDate: '2020-05-01',
  feeOre: 412_500,
  invoiceInterval: 'monthly' as const,
  shareRatio: 2.145,
  depositOre: 35_000_000,
  grantedOn: '2004-05-01',
}

test('a bostadsrätt is created with its owners, units and details', async () => {
  const { run } = harness()
  const { id } = await run(createOwnership(ownership))
  const created = await run(getOwnership(id))
  expect(created.kind).toBe('tenant_ownership')
  expect(created.ownerNames).toBe('Anna och Erik')
  expect(created.owners.map((o) => [o.id, o.sharePercent, o.receivesInvoices])).toEqual([
    ['anna', 50, false],
    ['erik', 50, true],
  ])
  expect(created.units.map((u) => u.label)).toEqual(['1001', 'F1'])
  expect(created).toMatchObject({ rentOre: 412_500, shareRatio: 2.145, endDate: null })
  // The fee is a charge; andelstal and insats live in the apartment register.
  expect(created.charges.map((c) => [c.kind, c.amountOre, c.fromDate, c.toDate])).toEqual([
    ['fee', 412_500, '2020-05-01', null],
  ])
  expect(created.apartmentUnitId).toBe('u1')
})

test('owners must share 100 % and units must be free', async () => {
  const { run } = harness()
  const halves = ownership.owners.map((o) => ({ ...o, sharePercent: 40 }))
  expect(await fail(run(createOwnership({ ...ownership, owners: halves })))).toContain('100 %')
  await run(createOwnership(ownership))
  expect(await fail(run(createOwnership({ ...ownership, startDate: '2024-01-01' })))).toContain(
    'redan ett avtal',
  )
})

test('a transfer ends the sellers’ bostadsrätt and starts the buyers’; deleting undoes it', async () => {
  const { run } = harness()
  const { id: sellerId } = await run(createOwnership(ownership))
  const { id: buyerId } = await run(
    transferOwnership({
      ownershipId: sellerId,
      transferDate: '2026-11-01',
      owners: [{ partyId: 'maja', sharePercent: 100 }],
      invoiceRecipientId: null,
    }),
  )
  const seller = await run(getOwnership(sellerId))
  const buyer = await run(getOwnership(buyerId))
  expect(seller.endDate).toBe('2026-10-31')
  expect(seller.next).toMatchObject({ id: buyerId, startDate: '2026-11-01' })
  expect(buyer).toMatchObject({ startDate: '2026-11-01', endDate: null, rentOre: 412_500 })
  expect(buyer.previous?.id).toBe(sellerId)
  expect(buyer.ownerNames).toBe('Maja')
  expect(buyer.units.map((u) => u.id).sort()).toEqual(['f1', 'u1'])

  expect(
    await fail(
      run(
        transferOwnership({
          ownershipId: sellerId,
          transferDate: '2026-12-01',
          owners: [{ partyId: 'anna', sharePercent: 100 }],
          invoiceRecipientId: null,
        }),
      ),
    ),
  ).toContain('redan överlåten')
  expect(await fail(run(deleteOwnership(sellerId)))).toContain('Ta bort den först')

  await run(deleteOwnership(buyerId))
  expect((await run(getOwnership(sellerId))).endDate).toBeNull()
})

test('a new fee from a date ends the old one and makes up already billed days', async () => {
  const { run, sqlite } = harness()
  const { id } = await run(createOwnership(ownership))
  const before = await run(getOwnership(id))
  // November was already billed at the old fee.
  sqlite.exec(`
    INSERT INTO invoice (id, organization_id, number, ocr, agreement_id, party_id, recipient_name,
      period_start, period_end, issue_date, due_date, net_ore, vat_ore, total_ore)
    VALUES ('i1', 'org', 1, '18', '${id}', 'erik', 'Anna och Erik', '2026-11-01', '2026-11-30',
      '2026-10-12', '2026-10-30', 412500, 0, 412500);
    INSERT INTO invoice_line (id, invoice_id, organization_id, position, kind, charge_id,
      description, net_ore, vat_rate_percent, vat_ore)
    VALUES ('l1', 'i1', 'org', 1, 'fee', '${before.baseChargeId}', 'Avgift', 412500, 0, 0);
  `)
  const result = await run(
    changeBaseCharge({ agreementId: id, fromDate: '2026-11-01', amountOre: 429_000 }),
  )
  expect(result.retroactiveOre).toBe(16_500)
  const after = await run(getOwnership(id))
  expect(after.charges.map((c) => [c.kind, c.amountOre, c.fromDate, c.toDate])).toEqual([
    ['fee', 412_500, '2020-05-01', '2026-10-31'],
    ['one_off', 16_500, expect.any(String), null],
    ['fee', 429_000, '2026-11-01', null],
  ])
  expect(after.charges.find((c) => c.kind === 'one_off')?.description).toBe(
    'Retroaktiv justering av avgift 2026-11-01 – 2026-11-30',
  )
})
