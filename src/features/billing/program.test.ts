import { expect, test } from 'bun:test'
import { createLease, updateLease } from '#/features/leases/program'
import { portfolio } from '#/features/portfolio/program'
import { createUnit } from '#/features/properties/program'
import { grantPresets } from '#/lib/managed-access'
import { fail, harness } from '#/test/harness'
import { getPlan } from './program'

const lease = (unitIds: string[], vat = false) => ({
  tenantId: 'anna',
  coTenantIds: [],
  invoiceRecipientId: null,
  unitIds,
  startDate: '2026-01-01',
  termEndDate: null,
  extensionMonths: null,
  noticePeriodMonths: 3,
  rentOre: 100_000,
  rentInterval: 'monthly' as const,
  invoiceInterval: 'monthly' as const,
  vat,
})

/** The fixture company as `kind` on the tier `override` (null: its subscription decides). */
function as(kind: string, override: string | null) {
  const h = harness()
  h.sqlite.exec(
    `UPDATE organization_settings SET kind = '${kind}', plan_override = ${override ? `'${override}'` : 'NULL'} WHERE organization_id = 'org'`,
  )
  return h
}

test('a BRF lets things out from Förening Plus, bought through Stripe', async () => {
  const { run, sqlite } = as('brf', null)
  expect(await fail(run(createLease(lease(['p1']))))).toContain(
    'ingår inte i Förening. Det finns i Förening Plus',
  )
  sqlite.exec(
    "INSERT INTO subscription (id, plan, reference_id, status) VALUES ('s1', 'brf_plus', 'org', 'active')",
  )
  await run(createLease(lease(['p1'])))
  // A subscription that has ended no longer counts.
  sqlite.exec("UPDATE subscription SET status = 'canceled' WHERE id = 's1'")
  expect(await fail(run(createLease(lease(['f1']))))).toContain('Förening Plus')
})

test('a free landlord lets homes but not premises, up to five units', async () => {
  const { run, sqlite, quantitySyncs } = as('landlord', null)
  sqlite.exec(
    "INSERT INTO unit (id, organization_id, property_id, kind, label) VALUES ('c1', 'org', 'p', 'commercial', 'L1')",
  )
  await run(createLease(lease(['u1'])))
  expect(await fail(run(createLease(lease(['c1']))))).toContain('Det finns i Hyresvärd')
  expect(await fail(run(createLease(lease(['p1'], true))))).toContain('Hyresvärd')

  // u1 and c1 count; parking and storage don't.
  const unit = (label: string, kind: 'apartment' | 'parking') =>
    createUnit({ propertyId: 'p', kind, label, areaSqm: null })
  await run(unit('1002', 'apartment'))
  await run(unit('1003', 'apartment'))
  await run(unit('1004', 'apartment'))
  expect(await fail(run(unit('1005', 'apartment')))).toContain('räcker för 5')
  await run(unit('P9', 'parking'))
  // Every change of units asks for the quantity to be synced.
  expect(quantitySyncs).toHaveLength(4)

  const plan = await run(getPlan)
  expect(plan).toMatchObject({
    kind: 'landlord',
    tier: 'landlord_free',
    byAgreement: false,
    subscription: null,
    usage: { apartments: 4, units: 5 },
    quantity: null,
    billingConfigured: false,
  })
})

test('after moving to a smaller tier, existing leases can still be corrected', async () => {
  const { run, sqlite } = as('landlord', 'landlord_pro')
  sqlite.exec(
    "INSERT INTO unit (id, organization_id, property_id, kind, label) VALUES ('c1', 'org', 'p', 'commercial', 'L1')",
  )
  const { tenantId: _, ...terms } = lease(['u1'], true)
  const { id: leaseId } = await run(createLease({ ...terms, tenantId: 'anna' }))
  sqlite.exec("UPDATE organization_settings SET plan_override = NULL WHERE organization_id = 'org'")
  await run(updateLease({ ...terms, leaseId, rentOre: 120_000 }))
  // Adding a lokal is new paid work.
  expect(await fail(run(updateLease({ ...terms, leaseId, unitIds: ['u1', 'c1'] })))).toContain(
    'Det finns i Hyresvärd',
  )
})

test('in a managed company its own tier applies; Alla bolag is the manager’s', async () => {
  const { run, runAs, sqlite } = as('brf', null)
  const now = Date.now()
  sqlite.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('mgr', 'Förvaltning', 'mgr', ${now});
    INSERT INTO organization_settings (organization_id, kind) VALUES ('mgr', 'manager');
  `)
  const grant = grantPresets.full
  const staff = runAs({
    home: { id: 'mgr', name: 'Förvaltning', role: 'owner' },
    organization: { id: 'org', name: 'Test', role: 'owner', grant },
  })
  expect(await fail(staff(createLease(lease(['p1']))))).toContain('Förening Plus')

  const manager = runAs({ home: { id: 'mgr', name: 'Förvaltning', role: 'owner' } })
  expect(await fail(manager(portfolio))).toContain('Det finns i Förvaltare')
  sqlite.exec(
    "UPDATE organization_settings SET plan_override = 'manager' WHERE organization_id = 'mgr'",
  )
  await manager(portfolio)
  // The plan page is about the user's own company.
  expect(await fail(staff(getPlan))).toContain('Forbidden')
  expect(await run(getPlan)).toMatchObject({ tier: 'brf_free' })
})
