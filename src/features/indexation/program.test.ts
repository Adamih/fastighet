import { expect, test } from 'bun:test'
import { createInvoiceRun } from '#/features/invoicing/program'
import { createLease, updateLease } from '#/features/leases/program'
import { addMonths, stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'
import {
  indexAdjustments,
  indexationPreview,
  removeIndexClause,
  runIndexation,
  setIndexClause,
} from './program'

const today = stockholmDate(Date.now())
const nextMonth = addMonths(`${today.slice(0, 7)}-01`, 1).slice(0, 7)

const lease = (unitIds: string[], termEndDate: string | null) =>
  createLease({
    tenantId: 'anna',
    coTenantIds: [],
    invoiceRecipientId: null,
    unitIds,
    startDate: '2024-01-01',
    termEndDate,
    extensionMonths: termEndDate ? 36 : null,
    noticePeriodMonths: 9,
    rentOre: 20_000_00,
    rentInterval: 'monthly',
    invoiceInterval: 'monthly',
    vat: true,
  })

/** A shop let for five years at 20 000 kr a month plus VAT, with a standard index clause. */
async function indexedShop() {
  const h = harness()
  h.sqlite.exec(
    "INSERT INTO unit (id, organization_id, property_id, kind, label) VALUES ('c1', 'org', 'p', 'commercial', 'L1')",
  )
  const shop = await h.run(lease(['c1'], '2028-12-31'))
  await h.run(
    setIndexClause({
      leaseId: shop.id,
      sharePercent: 100,
      baseMonth: '2023-10',
      adjustmentMonth: 1,
      floorAtBase: true,
    }),
  )
  return { ...h, shop }
}

const indexCharges = (sqlite: ReturnType<typeof harness>['sqlite']) =>
  sqlite
    .query(
      "select amount_ore, interval, vat, from_date, to_date from charge where kind = 'index' order by from_date",
    )
    .all()

test('the yearly indexation adds an index supplement and leaves the base rent alone', async () => {
  const { run, sqlite, shop } = await indexedShop()
  const [row] = await run(indexationPreview(2026))
  // 240 000 kr × (419,35 − 409,07) / 409,07 = 6 031 kr a year.
  expect(row).toMatchObject({
    leaseId: shop.id,
    status: 'ready',
    effectiveDate: '2026-01-01',
    baseKpi: 40907,
    kpiMonth: '2025-10',
    kpi: 41935,
    baseRentPerYearOre: 240_000_00,
    currentSupplementOre: 0,
    newSupplementOre: 6_031_00,
  })
  expect(await run(runIndexation(2026))).toEqual({ adjusted: 1, skipped: 0 })
  expect(indexCharges(sqlite)).toEqual([
    { amount_ore: 6_031_00, interval: 'yearly', vat: 1, from_date: '2026-01-01', to_date: null },
  ])
  const rent = sqlite.query("select amount_ore, to_date from charge where kind = 'rent'").all()
  expect(rent).toEqual([{ amount_ore: 20_000_00, to_date: null }])

  // Running it again changes nothing.
  expect((await run(indexationPreview(2026)))[0].status).toBe('done')
  expect(await run(runIndexation(2026))).toEqual({ adjusted: 0, skipped: 1 })
  expect(await run(indexAdjustments(shop.id))).toHaveLength(1)
  expect(await fail(run(removeIndexClause(shop.id)))).toContain('har använts')
})

test('a missing KPI value blocks the run until SCB has published it', async () => {
  const { run, sqlite, kpiFeed } = await indexedShop()
  await run(runIndexation(2026))
  expect((await run(indexationPreview(2027)))[0]).toMatchObject({
    status: 'missing_kpi',
    kpi: null,
  })
  expect(await fail(run(runIndexation(2027)))).toContain('KPI för oktober 2026 finns inte än')

  // Once SCB has October, the preview fetches it and the run replaces last year's supplement.
  kpiFeed.push({ month: '2026-10', valueHundredths: 42400 })
  expect((await run(indexationPreview(2027)))[0]).toMatchObject({
    status: 'ready',
    currentSupplementOre: 6_031_00,
    newSupplementOre: 8_759_00,
  })
  await run(runIndexation(2027))
  expect(indexCharges(sqlite)).toEqual([
    {
      amount_ore: 6_031_00,
      interval: 'yearly',
      vat: 1,
      from_date: '2026-01-01',
      to_date: '2026-12-31',
    },
    { amount_ore: 8_759_00, interval: 'yearly', vat: 1, from_date: '2027-01-01', to_date: null },
  ])
})

test('days already billed at the old rent are made up on the next avi', async () => {
  const { run, sqlite } = await indexedShop()
  await run(createInvoiceRun({ month: nextMonth, send: false }))
  await run(runIndexation(2026))
  const [oneOff] = sqlite
    .query("select amount_ore as amount, description from charge where kind = 'one_off'")
    .all() as { amount: number; description: string }[]
  // About a twelfth of 6 031 kr for the month already invoiced.
  expect(Math.abs(oneOff.amount - 502_58)).toBeLessThan(2_00)
  expect(oneOff.description).toStartWith('Retroaktiv justering av indextillägg 2026-01-01')
})

test('only premises let for at least three years can have an index clause', async () => {
  const { run } = harness()
  const flat = await run(lease(['u1'], '2028-12-31'))
  const clause = { sharePercent: 100, baseMonth: '2023-10', adjustmentMonth: 1, floorAtBase: true }
  expect(await fail(run(setIndexClause({ leaseId: flat.id, ...clause })))).toContain(
    'Bostadshyror kan inte indexeras',
  )
  const storage = await run(lease(['f1'], null))
  expect(await fail(run(setIndexClause({ leaseId: storage.id, ...clause })))).toContain(
    'bestämd tid',
  )
})

test("a lease edit can't leave its index clause invalid", async () => {
  const { run, shop } = await indexedShop()
  const edit = {
    leaseId: shop.id,
    coTenantIds: [],
    invoiceRecipientId: null,
    unitIds: ['c1'],
    startDate: shop.startDate,
    termEndDate: null,
    extensionMonths: null,
    noticePeriodMonths: 9,
    rentOre: 20_000_00,
    rentInterval: 'monthly' as const,
    invoiceInterval: 'monthly' as const,
    vat: true,
  }
  expect(await fail(run(updateLease(edit)))).toContain('Avtalet har en indexklausul')
  const saved = await run(updateLease({ ...edit, termEndDate: '2029-12-31', extensionMonths: 36 }))
  expect(saved.indexClause).toMatchObject({ sharePercent: 100, baseMonth: '2023-10' })
})
