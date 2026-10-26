import { expect, test } from 'bun:test'
import { changeBaseCharge } from '#/features/agreements/program'
import { registerPledge, releasePledge } from '#/features/pledges/program'
import { grantPresets } from '#/lib/managed-access'
import { fail, harness } from '#/test/harness'
import {
  createOwnership,
  deleteOwnership,
  getOwnership,
  ownershipExtract,
  transferOwnership,
} from './program'

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

test('an extract shows the register as of its date: holders, pledges in force and history', async () => {
  const { run, sqlite } = harness()
  sqlite.exec(`
    UPDATE organization_settings SET organization_number = '769900-0002' WHERE organization_id = 'org';
    UPDATE property SET street_address = 'Lindvägen 4', postal_code = '75320', city = 'Uppsala';
    UPDATE unit SET area_sqm = 64, rooms = 2 WHERE id = 'u1';
  `)
  const { id } = await run(createOwnership(ownership))
  const notice = (creditorName: string, notifiedOn: string) => ({
    ownershipId: id,
    creditorName,
    creditorOrganizationNumber: '',
    reference: '',
    notifiedOn,
    note: '',
  })
  const { id: first } = await run(
    registerPledge({ ...notice('Första banken', '2021-01-10'), reference: 'A-1' }),
  )
  await run(registerPledge(notice('Andra banken', '2023-05-01')))
  await run(releasePledge({ pledgeId: first, releasedOn: '2024-02-01', note: 'Lånet löst' }))
  await run(
    transferOwnership({
      ownershipId: id,
      transferDate: '2025-01-01',
      owners: [{ partyId: 'maja', sharePercent: 100 }],
      invoiceRecipientId: null,
    }),
  )

  // Before the release: both pledges in force, the first one first.
  const early = await run(
    ownershipExtract({ ownershipId: id, onDate: '2023-06-01', includeReleased: true }),
  )
  expect(early).toMatchObject({
    association: { name: 'Test', organizationNumber: '769900-0002' },
    apartment: {
      label: '1001',
      designation: 'Uppsala 1:1',
      streetAddress: 'Lindvägen 4',
      areaSqm: 64,
      rooms: 2,
      shareRatio: 2.145,
      depositOre: 35_000_000,
      grantedOn: '2004-05-01',
    },
    otherUnits: [{ label: 'F1', kind: 'storage' }],
    holders: [
      { name: 'Anna', sharePercent: 50 },
      { name: 'Erik', sharePercent: 50 },
    ],
    released: [],
    producedBy: { name: 'u', on: null },
  })
  expect(early.pledges.map((p) => [p.priority, p.creditorName, p.reference])).toEqual([
    [1, 'Första banken', 'A-1'],
    [2, 'Andra banken', null],
  ])

  // After it: the second bank is first; the released pledge only with the history.
  const later = await run(
    ownershipExtract({ ownershipId: id, onDate: '2024-12-31', includeReleased: false }),
  )
  expect(later.pledges.map((p) => [p.priority, p.creditorName])).toEqual([[1, 'Andra banken']])
  expect(later.released).toBeNull()
  const withHistory = await run(
    ownershipExtract({ ownershipId: id, onDate: '2024-12-31', includeReleased: true }),
  )
  expect(withHistory.released).toEqual([
    {
      creditorName: 'Första banken',
      reference: 'A-1',
      notifiedOn: '2021-01-10',
      releasedOn: '2024-02-01',
    },
  ])
  // Before the second notice arrived, only the first exists.
  const beforeSecond = await run(
    ownershipExtract({ ownershipId: id, onDate: '2022-01-01', includeReleased: true }),
  )
  expect(beforeSecond.pledges.map((p) => p.creditorName)).toEqual(['Första banken'])
})

test('an extract is for a day the right was held, never the future; a manager is named', async () => {
  const { run, runAs } = harness()
  const { id } = await run(createOwnership(ownership))
  expect(
    await fail(
      run(ownershipExtract({ ownershipId: id, onDate: '2020-04-30', includeReleased: false })),
    ),
  ).toContain('gäller från 2020-05-01')
  expect(
    await fail(
      run(ownershipExtract({ ownershipId: id, onDate: '2999-01-01', includeReleased: false })),
    ),
  ).toContain('framtiden')
  const { id: buyer } = await run(
    transferOwnership({
      ownershipId: id,
      transferDate: '2025-01-01',
      owners: [{ partyId: 'maja', sharePercent: 100 }],
      invoiceRecipientId: null,
    }),
  )
  expect(
    await fail(
      run(ownershipExtract({ ownershipId: id, onDate: '2025-01-01', includeReleased: false })),
    ),
  ).toContain('gällde 2020-05-01 – 2024-12-31')
  const extract = await run(
    ownershipExtract({ ownershipId: buyer, onDate: '2025-01-01', includeReleased: false }),
  )
  expect(extract.holders).toEqual([{ name: 'Maja', sharePercent: 100 }])

  const manager = runAs({
    user: 'frida',
    home: { id: 'mgr', name: 'Förvaltning', role: 'owner' },
    organization: { id: 'org', name: 'Test', role: 'owner', grant: grantPresets.readOnly },
  })
  expect(
    (
      await manager(
        ownershipExtract({ ownershipId: buyer, onDate: '2025-01-01', includeReleased: false }),
      )
    ).producedBy,
  ).toEqual({ name: 'frida', on: 'Förvaltning' })
})
