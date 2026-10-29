import { expect, test } from 'bun:test'
import { createOwnership } from '#/features/ownerships/program'
import { registerPledge, releasePledge } from '#/features/pledges/program'
import { stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'
import { asPortal } from '#/test/portal'
import { portalApartments, portalExtract } from './apartment-program'

const today = stockholmDate(Date.now())

async function setup() {
  const h = harness()
  const { id } = await h.run(
    createOwnership({
      owners: [
        { partyId: 'anna', sharePercent: 60 },
        { partyId: 'erik', sharePercent: 40 },
      ],
      invoiceRecipientId: null,
      unitIds: ['u1'],
      startDate: '2020-05-01',
      feeOre: 412_500,
      invoiceInterval: 'monthly',
      shareRatio: 2.145,
      depositOre: 35_000_000,
      grantedOn: '2004-05-01',
    }),
  )
  const notice = (creditorName: string, notifiedOn: string) => ({
    ownershipId: id,
    creditorName,
    creditorOrganizationNumber: '',
    reference: '',
    notifiedOn,
    note: '',
  })
  await h.run(registerPledge(notice('Andra banken', '2024-03-01')))
  const { id: first } = await h.run(registerPledge(notice('Första banken', '2021-06-15')))
  const { id: old } = await h.run(registerPledge(notice('Gamla banken', '2020-06-01')))
  await h.run(releasePledge({ pledgeId: old, releasedOn: '2021-01-10', note: '' }))
  return { ...h, ownershipId: id, firstPledge: first }
}

test("a member sees their bostadsrätt's register entry and its pledges in priority order", async () => {
  const h = await setup()
  const [entry] = await h.run(asPortal(['erik'])(portalApartments))
  expect(entry.apartment).toMatchObject({
    label: '1001',
    shareRatio: 2.145,
    depositOre: 35_000_000,
  })
  expect(entry.holders).toEqual([
    { name: 'Anna', sharePercent: 60 },
    { name: 'Erik', sharePercent: 40 },
  ])
  expect(entry.pledges.map((p) => [p.creditorName, p.active, p.priority])).toEqual([
    ['Första banken', true, 1],
    ['Andra banken', true, 2],
    ['Gamla banken', false, null],
  ])
  expect(await h.run(asPortal(['maja'])(portalApartments))).toEqual([])
})

test('the extract lists the pledges in force and names the party asking', async () => {
  const h = await setup()
  const extract = await h.run(asPortal(['anna'])(portalExtract(h.ownershipId)))
  expect(extract).toMatchObject({ onDate: today, partyId: 'anna', association: { name: 'Test' } })
  expect(extract.pledges.map((p) => [p.priority, p.creditorName])).toEqual([
    [1, 'Första banken'],
    [2, 'Andra banken'],
  ])
  expect(await fail(h.run(asPortal(['maja'])(portalExtract(h.ownershipId))))).toContain('NotFound')
})
