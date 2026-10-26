import { expect, test } from 'bun:test'
import { harness } from '#/test/harness'

// Tenant isolation in the database itself: references between domain tables are composite keys
// on (organization_id, id), so a row can't point at another company's row.

function twoCompanies() {
  const { sqlite } = harness()
  const now = Date.now()
  sqlite.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('other', 'Other', 'other', ${now});
    INSERT INTO party (id, organization_id, kind, name) VALUES ('olle', 'other', 'person', 'Olle');
    INSERT INTO agreement (id, organization_id, number, kind, start_date, invoice_interval)
      VALUES ('a1', 'org', 1, 'lease', '2026-01-01', 'monthly');
  `)
  return sqlite
}

test("a row can't reference another company's row", () => {
  const sqlite = twoCompanies()
  const addParty = (partyId: string) =>
    sqlite.run(
      `INSERT INTO agreement_party (id, organization_id, agreement_id, party_id, role, position, from_date)
        VALUES (?, 'org', 'a1', ?, 'tenant', 0, '2026-01-01')`,
      [crypto.randomUUID(), partyId],
    )
  expect(() => addParty('anna')).not.toThrow()
  expect(() => addParty('olle')).toThrow(/FOREIGN KEY/)
  // Nor by claiming to belong to the other company while pointing at this one's agreement.
  expect(() =>
    sqlite.run(
      `INSERT INTO agreement_unit (id, organization_id, agreement_id, unit_id, from_date)
        VALUES ('x', 'other', 'a1', 'u1', '2026-01-01')`,
    ),
  ).toThrow(/FOREIGN KEY/)
})

test('deleting a company still removes all its rows', () => {
  const sqlite = twoCompanies()
  sqlite.exec(`
    INSERT INTO agreement_party (id, organization_id, agreement_id, party_id, role, position, from_date)
      VALUES ('ap', 'org', 'a1', 'anna', 'tenant', 0, '2026-01-01');
    DELETE FROM organization WHERE id = 'org';
  `)
  const count = (table: string) =>
    (sqlite.query(`select count(*) as n from ${table}`).get() as { n: number }).n
  expect(count('agreement_party')).toBe(0)
  expect(count('party')).toBe(1)
})
