import { expect, test } from 'bun:test'
import { addOneOffCharge, removeOneOffCharge } from '#/features/agreements/program'
import { fail, harness } from '#/test/harness'
import { changeLeaseFrom, createLease, getLease, updateLease } from './program'

const lease = {
  tenantId: 'anna',
  coTenantIds: [],
  invoiceRecipientId: null,
  unitIds: ['u1'],
  startDate: '2024-01-01',
  termEndDate: null,
  extensionMonths: null,
  noticePeriodMonths: 3,
  rentOre: 900_000,
  rentInterval: 'monthly' as const,
  invoiceInterval: 'monthly' as const,
  vat: false,
}

test('a lease starts with its rent as a charge and its tenant and units from the start', async () => {
  const { run } = harness()
  const created = await run(createLease(lease))
  expect(created.charges.map((c) => [c.kind, c.amountOre, c.fromDate])).toEqual([
    ['rent', 900_000, '2024-01-01'],
  ])
  expect(created.partyRows.map((p) => [p.partyId, p.fromDate, p.toDate])).toEqual([
    ['anna', '2024-01-01', null],
  ])
  expect(created.rentOre).toBe(900_000)
})

test('co-tenants and units change from a date, keeping history', async () => {
  const { run } = harness()
  const { id } = await run(createLease(lease))
  const changed = await run(
    changeLeaseFrom({
      leaseId: id,
      fromDate: '2026-12-01',
      coTenantIds: ['erik'],
      invoiceRecipientId: 'erik',
      unitIds: ['u1', 'p1'],
    }),
  )
  // Anna stops receiving the avier, so her row ends and a new one starts; Erik joins.
  expect(
    changed.partyRows
      .map((p) => [p.partyId, p.receivesInvoices, p.fromDate, p.toDate])
      .sort(
        (a, b) =>
          String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0])),
      ),
  ).toEqual([
    ['anna', true, '2024-01-01', '2026-11-30'],
    ['anna', false, '2026-12-01', null],
    ['erik', true, '2026-12-01', null],
  ])
  expect(changed.unitRows.map((u) => [u.unitId, u.fromDate, u.toDate]).sort()).toEqual([
    ['p1', '2026-12-01', null],
    ['u1', '2024-01-01', null],
  ])
  // Moving out again ends Erik's row the day before.
  const after = await run(
    changeLeaseFrom({
      leaseId: id,
      fromDate: '2027-03-01',
      coTenantIds: [],
      invoiceRecipientId: null,
      unitIds: ['u1', 'p1'],
    }),
  )
  expect(after.partyRows.find((p) => p.partyId === 'erik')?.toDate).toBe('2027-02-28')
  expect(
    await fail(
      run(
        changeLeaseFrom({
          leaseId: id,
          fromDate: '2024-01-01',
          coTenantIds: ['erik'],
          invoiceRecipientId: null,
          unitIds: ['u1'],
        }),
      ),
    ),
  ).toContain('efter avtalets start')
})

test('one-off amounts can be removed until an avi bills them', async () => {
  const { run, sqlite } = harness()
  const { id } = await run(createLease(lease))
  const key = await run(
    addOneOffCharge({
      agreementId: id,
      description: 'Ny nyckel',
      amountOre: 45_000,
      fromDate: '2026-11-10',
      vat: false,
    }),
  )
  await run(removeOneOffCharge(key.id))
  expect((await run(getLease(id))).charges.map((c) => c.kind)).toEqual(['rent'])

  const cleaning = await run(
    addOneOffCharge({
      agreementId: id,
      description: 'Flyttstädning',
      amountOre: 150_000,
      fromDate: '2026-11-10',
      vat: false,
    }),
  )
  sqlite.exec(`
    INSERT INTO invoice (id, organization_id, number, ocr, agreement_id, party_id, recipient_name,
      period_start, period_end, issue_date, due_date, net_ore, vat_ore, total_ore)
    VALUES ('i1', 'org', 1, '18', '${id}', 'anna', 'Anna', '2026-12-01', '2026-12-31',
      '2026-11-11', '2026-11-30', 1050000, 0, 1050000);
    INSERT INTO invoice_line (id, invoice_id, organization_id, position, kind, charge_id,
      description, net_ore, vat_rate_percent, vat_ore)
    VALUES ('l1', 'i1', 'org', 1, 'one_off', '${cleaning.id}', 'Flyttstädning', 150000, 0, 0);
  `)
  expect(await fail(run(removeOneOffCharge(cleaning.id)))).toContain('aviserat')
  expect((await run(getLease(id))).billedChargeIds).toEqual([cleaning.id])
})

test('a billed rent can only change from a date, not be corrected', async () => {
  const { run, sqlite } = harness()
  const created = await run(createLease(lease))
  sqlite.exec(`
    INSERT INTO invoice (id, organization_id, number, ocr, agreement_id, party_id, recipient_name,
      period_start, period_end, issue_date, due_date, net_ore, vat_ore, total_ore)
    VALUES ('i1', 'org', 1, '18', '${created.id}', 'anna', 'Anna', '2026-11-01', '2026-11-30',
      '2026-10-12', '2026-10-30', 900000, 0, 900000);
    INSERT INTO invoice_line (id, invoice_id, organization_id, position, kind, charge_id,
      description, net_ore, vat_rate_percent, vat_ore)
    VALUES ('l1', 'i1', 'org', 1, 'rent', '${created.baseChargeId}', 'Hyra', 900000, 0, 0);
  `)
  const { tenantId: _, ...fields } = lease
  expect(
    await fail(run(updateLease({ leaseId: created.id, ...fields, rentOre: 950_000 }))),
  ).toContain('Ändra hyra')
})
