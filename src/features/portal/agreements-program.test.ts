import { expect, test } from 'bun:test'
import { createLease } from '#/features/leases/program'
import { fail, harness } from '#/test/harness'
import { asPortal } from '#/test/portal'
import { portalAgreement, portalAgreements } from './agreements-program'

async function setup() {
  const h = harness()
  const lease = await h.run(
    createLease({
      tenantId: 'anna',
      coTenantIds: ['erik'],
      invoiceRecipientId: null,
      unitIds: ['u1'],
      startDate: '2024-01-01',
      termEndDate: null,
      extensionMonths: null,
      noticePeriodMonths: 3,
      rentOre: 900_000,
      rentInterval: 'monthly',
      invoiceInterval: 'monthly',
      vat: false,
    }),
  )
  return { ...h, leaseId: lease.id }
}

test('every party on a lease sees it with its units, rent and people', async () => {
  const h = await setup()
  for (const party of ['anna', 'erik']) {
    expect(await h.run(asPortal([party])(portalAgreements))).toMatchObject([
      {
        id: h.leaseId,
        kind: 'lease',
        status: 'active',
        rentOre: 900_000,
        units: [{ label: '1001' }],
      },
    ])
  }
  const detail = await h.run(asPortal(['erik'])(portalAgreement(h.leaseId)))
  expect(detail.parties).toMatchObject([
    { id: 'anna', role: 'tenant', receivesInvoices: true, mine: false },
    { id: 'erik', role: 'co_tenant', mine: true },
  ])
  expect(detail.charges).toMatchObject([{ kind: 'rent', base: true, amountOre: 900_000 }])
  expect(detail.terms.noticePeriodMonths).toBe(3)
})

test("someone else's agreement is not found", async () => {
  const h = await setup()
  expect(await h.run(asPortal(['maja'])(portalAgreements))).toEqual([])
  expect(await fail(h.run(asPortal(['maja'])(portalAgreement(h.leaseId))))).toContain('NotFound')
})

test('rent decided for later shows as upcoming', async () => {
  const h = await setup()
  h.sqlite.exec(`
    UPDATE charge SET to_date = '2099-12-31' WHERE agreement_id = '${h.leaseId}';
    INSERT INTO charge (id, organization_id, agreement_id, kind, amount_ore, interval, vat, from_date)
      VALUES ('later', 'org', '${h.leaseId}', 'rent', 950000, 'monthly', 0, '2100-01-01');
  `)
  const detail = await h.run(asPortal(['anna'])(portalAgreement(h.leaseId)))
  expect(detail.upcoming).toMatchObject([
    { id: 'later', amountOre: 950_000, fromDate: '2100-01-01' },
  ])
})

test("an index clause shows only where the company's tier has commercial premises", async () => {
  const h = await setup()
  h.sqlite.exec(`
    INSERT INTO index_clause (agreement_id, organization_id, share_percent, base_month, adjustment_month)
      VALUES ('${h.leaseId}', 'org', 100, '2023-10', 1);
  `)
  expect((await h.run(asPortal(['anna'])(portalAgreement(h.leaseId)))).indexClause).toMatchObject({
    sharePercent: 100,
    baseMonth: '2023-10',
  })
  expect(
    (await h.run(asPortal(['anna'], 'landlord_free')(portalAgreement(h.leaseId)))).indexClause,
  ).toBeNull()
})
