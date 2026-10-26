import { expect, test } from 'bun:test'
import { changeBaseCharge } from '#/features/agreements/program'
import { fail, harness } from '#/test/harness'
import { createOwnership, deleteOwnership, getOwnership, transferOwnership } from './program'

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
