import { expect, test } from 'bun:test'
import { createLease } from '#/features/leases/program'
import {
  createOwnership,
  deleteOwnership,
  getOwnership,
  listOwnerships,
  transferOwnership,
} from '#/features/ownerships/program'
import { addDays, stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'
import { registerPledge, releasePledge } from './program'

const today = stockholmDate(Date.now())

const ownership = {
  owners: [{ partyId: 'anna', sharePercent: 100 }],
  invoiceRecipientId: null,
  unitIds: ['u1'],
  startDate: '2020-05-01',
  feeOre: 412_500,
  invoiceInterval: 'monthly' as const,
  shareRatio: 2.145,
  depositOre: 35_000_000,
  grantedOn: '2004-05-01',
}

const notice = (ownershipId: string, creditorName: string, notifiedOn: string) => ({
  ownershipId,
  creditorName,
  creditorOrganizationNumber: '',
  reference: '',
  notifiedOn,
  note: '',
})

test('pledges are registered in priority order and released, keeping the history', async () => {
  const { run } = harness()
  const { id } = await run(createOwnership(ownership))
  await run(registerPledge({ ...notice(id, 'Andra banken', '2024-03-01'), reference: 'L-2' }))
  const { id: first } = await run(
    registerPledge({
      ...notice(id, 'Första banken', '2021-06-15'),
      creditorOrganizationNumber: '5560009999',
    }),
  )
  let view = await run(getOwnership(id))
  expect(view.pledges.map((p) => [p.creditorName, p.priority, p.reference])).toEqual([
    ['Första banken', 1, null],
    ['Andra banken', 2, 'L-2'],
  ])
  expect(view.pledges[0].creditorOrganizationNumber).toBe('556000-9999')

  await run(releasePledge({ pledgeId: first, releasedOn: today, note: 'På bankens begäran' }))
  view = await run(getOwnership(id))
  expect(view.pledges.map((p) => [p.creditorName, p.active, p.priority, p.releaseNote])).toEqual([
    ['Andra banken', true, 1, null],
    ['Första banken', false, null, 'På bankens begäran'],
  ])
  expect(
    await fail(run(releasePledge({ pledgeId: first, releasedOn: today, note: '' }))),
  ).toContain('redan avregistrerad')
  // The register shows the count in force.
  const [listed] = await run(listOwnerships)
  expect(listed.activePledges).toBe(1)
})

test('dates are checked: not in the future, not after the right was sold', async () => {
  const { run } = harness()
  const { id } = await run(createOwnership(ownership))
  expect(await fail(run(registerPledge(notice(id, 'Bank', addDays(today, 1)))))).toContain(
    'framtiden',
  )
  const { id: pledgeId } = await run(registerPledge(notice(id, 'Bank', '2024-01-10')))
  expect(
    await fail(run(releasePledge({ pledgeId, releasedOn: '2024-01-09', note: '' }))),
  ).toContain('före underrättelsen')

  await run(
    transferOwnership({
      ownershipId: id,
      transferDate: '2026-01-01',
      owners: [{ partyId: 'maja', sharePercent: 100 }],
      invoiceRecipientId: null,
    }),
  )
  expect(await fail(run(registerPledge(notice(id, 'Sen bank', '2026-01-02'))))).toContain(
    'redan överlåten',
  )
  // A notice from before the sale can still be registered on the sellers' right.
  await run(registerPledge(notice(id, 'Tidig bank', '2025-12-31')))
})

test('only on a bostadsrätt of the company', async () => {
  const { run, runAs, sqlite } = harness()
  const lease = await run(
    createLease({
      tenantId: 'erik',
      coTenantIds: [],
      invoiceRecipientId: null,
      unitIds: ['p1'],
      startDate: '2024-01-01',
      termEndDate: null,
      extensionMonths: null,
      noticePeriodMonths: 3,
      rentOre: 50_000,
      rentInterval: 'monthly',
      invoiceInterval: 'monthly',
      vat: false,
    }),
  )
  expect(await fail(run(registerPledge(notice(lease.id, 'Bank', '2024-02-01'))))).toContain(
    'NotFound',
  )
  const { id } = await run(createOwnership(ownership))
  const now = Date.now()
  sqlite.exec(
    `INSERT INTO organization (id, name, slug, created_at) VALUES ('other', 'Annat', 'other', ${now})`,
  )
  const other = runAs({ home: { id: 'other', name: 'Annat', role: 'owner' } })
  expect(await fail(other(registerPledge(notice(id, 'Bank', '2024-02-01'))))).toContain('NotFound')
  const { id: pledgeId } = await run(registerPledge(notice(id, 'Bank', '2024-02-01')))
  expect(await fail(other(releasePledge({ pledgeId, releasedOn: today, note: '' })))).toContain(
    'NotFound',
  )
})

test('a sale shows the sellers’ pledges and can release them; pledges never move', async () => {
  const { run } = harness()
  const { id } = await run(createOwnership(ownership))
  const { id: keep } = await run(registerPledge(notice(id, 'Kvarstående bank', '2022-01-01')))
  const { id: release } = await run(registerPledge(notice(id, 'Säljarens bank', '2021-01-01')))
  const sale = {
    ownershipId: id,
    transferDate: addDays(today, 30),
    owners: [{ partyId: 'maja', sharePercent: 100 }],
    invoiceRecipientId: null,
  }
  expect(
    await fail(run(transferOwnership({ ...sale, releasePledgeIds: ['not-a-pledge'] }))),
  ).toContain('inte längre registrerad')

  const { id: buyerId } = await run(transferOwnership({ ...sale, releasePledgeIds: [release] }))
  const seller = await run(getOwnership(id))
  expect(seller.pledges.map((p) => [p.id, p.active, p.releasedOn, p.releaseNote])).toEqual([
    [keep, true, null, null],
    [release, false, today, 'Avregistrerad vid överlåtelsen'],
  ])
  expect((await run(getOwnership(buyerId))).pledges).toEqual([])
})

test('a bostadsrätt with pledges, even released ones, is never deleted', async () => {
  const { run } = harness()
  const { id } = await run(createOwnership(ownership))
  const { id: pledgeId } = await run(registerPledge(notice(id, 'Bank', '2024-02-01')))
  await run(releasePledge({ pledgeId, releasedOn: today, note: '' }))
  expect(await fail(run(deleteOwnership(id)))).toContain('pantsättningar')
})
