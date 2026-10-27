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
import { confirmPledge, pledgeConfirmation, registerAndConfirm } from './confirmation'
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

test('the förening’s fees are charged as one-off amounts, unless the board skips them', async () => {
  const { run, sqlite } = harness()
  const { id } = await run(createOwnership(ownership))
  // Not charged until the bylaws' shares are set.
  await run(registerPledge({ ...notice(id, 'Ingen avgift', '2025-02-01'), chargeFee: true }))
  sqlite.exec(
    "UPDATE organization_settings SET pledge_fee_basis_points = 100, transfer_fee_basis_points = 250 WHERE organization_id = 'org'",
  )
  await run(registerPledge({ ...notice(id, 'Bank', '2026-03-01'), chargeFee: true }))
  await run(registerPledge({ ...notice(id, 'Skippad', '2026-03-02'), chargeFee: false }))
  // A buyer's bank often notifies before tillträde; the fee waits for the right's first day.
  const fees = (view: {
    charges: { kind: string; amountOre: number; fromDate: string; description: string | null }[]
  }) =>
    view.charges
      .filter((c) => c.kind === 'pledge_fee' || c.kind === 'transfer_fee')
      .map((c) => [c.kind, c.amountOre, c.fromDate, c.description])
  expect(fees(await run(getOwnership(id)))).toEqual([
    ['pledge_fee', 59_200, '2026-03-01', 'Pantsättningsavgift, Bank'],
  ])
  expect(
    await fail(run(registerPledge({ ...notice(id, 'Gammal', '2019-05-01'), chargeFee: true }))),
  ).toContain('Prisbasbeloppet för 2019')

  const { id: buyerId, feeOre } = await run(
    transferOwnership({
      ownershipId: id,
      transferDate: '2026-06-01',
      owners: [{ partyId: 'maja', sharePercent: 100 }],
      invoiceRecipientId: null,
      chargeTransferFee: true,
    }),
  )
  expect(feeOre).toBe(148_000)
  expect(fees(await run(getOwnership(buyerId)))).toEqual([
    ['transfer_fee', 148_000, '2026-06-01', 'Överlåtelseavgift'],
  ])
  // The buyers' bank notifies before tillträde of the next sale's buyers.
  const { id: next } = await run(
    transferOwnership({
      ownershipId: buyerId,
      transferDate: '2026-09-01',
      owners: [{ partyId: 'erik', sharePercent: 100 }],
      invoiceRecipientId: null,
      chargeTransferFee: false,
    }),
  )
  await run(registerPledge({ ...notice(next, 'Eriks bank', '2026-08-20'), chargeFee: true }))
  expect(fees(await run(getOwnership(next)))).toEqual([
    ['pledge_fee', 59_200, '2026-09-01', 'Pantsättningsavgift, Eriks bank'],
  ])
})

test('the lender gets a confirmation by email, or one printed and posted', async () => {
  const { run, outbox } = harness()
  const { id } = await run(createOwnership(ownership))
  await run(registerPledge(notice(id, 'Första banken', '2021-06-15')))
  const { id: pledgeId, confirmed } = await run(
    registerAndConfirm({
      ...notice(id, 'Andra banken', '2024-03-01'),
      reference: 'L-2',
      confirmationEmail: 'pant@bank.test',
    }),
  )
  expect(confirmed).toBe(true)
  const [mail] = outbox
  expect(mail.to).toBe('pant@bank.test')
  expect(mail.subject).toBe('Pantsättning registrerad: bostadsrätt 1 i Test, er ref. L-2')
  expect(mail.text).toContain('plats 2 i företrädesordningen')

  const registered = await run(pledgeConfirmation({ pledgeId, kind: 'registered' }))
  expect(registered.email).toBe('pant@bank.test')
  expect(registered.sentAt).toBeNumber()
  expect(registered.text.facts).toContainEqual(['Bostadsrättshavare', 'Anna'])
  expect(registered.text.facts).toContainEqual(['Företrädesordning', '2'])

  expect(await fail(run(pledgeConfirmation({ pledgeId, kind: 'released' })))).toContain(
    'inte avregistrerad',
  )
  await run(releasePledge({ pledgeId, releasedOn: today, note: '' }))
  const released = await run(pledgeConfirmation({ pledgeId, kind: 'released' }))
  expect(released.sentAt).toBeNull()
  expect(released.text.paragraphs[0]).toContain(`avregistrerats ur lägenhetsförteckningen ${today}`)
  // Sent by post: recorded without an email.
  await run(confirmPledge({ pledgeId, kind: 'released', email: '' }))
  expect(outbox).toHaveLength(1)
  const pledge = (await run(getOwnership(id))).pledges.find((p) => p.id === pledgeId)
  expect(pledge?.releaseConfirmedAt).toBeNumber()
  expect(pledge?.confirmationEmail).toBe('pant@bank.test')
})
