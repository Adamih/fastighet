import { expect, test } from 'bun:test'
import { createInvoiceRun, listInvoices, markInvoicePaid } from '#/features/invoicing/program'
import { createLease } from '#/features/leases/program'
import { addMonths, stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'
import {
  exportSie,
  getBookkeepingSettings,
  listExports,
  previewExport,
  updateBookkeepingSettings,
} from './program'

const today = stockholmDate(Date.now())
const nextMonth = addMonths(`${today.slice(0, 7)}-01`, 1).slice(0, 7)
const everything = { fromDate: '2000-01-01', toDate: '2099-12-31' }

/** One lease at 9 000 kr a month, invoiced for next month and paid by hand. */
async function paidAvi(run: ReturnType<typeof harness>['run']) {
  await run(
    createLease({
      tenantId: 'anna',
      coTenantIds: [],
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
  await run(createInvoiceRun({ month: nextMonth, send: false }))
  const [avi] = await run(listInvoices({ filter: 'all' }))
  await run(markInvoicePaid({ invoiceId: avi.id, paidOn: today }))
  return avi
}

const decode = (base64: string) => Buffer.from(base64, 'base64').toString('latin1')

test('the preview counts vouchers per series and sums each account', async () => {
  const { run } = harness()
  await paidAvi(run)
  const preview = await run(previewExport(everything))
  expect(preview.series).toEqual({ F: 1, K: 0, B: 1 })
  expect(preview.totals.map((t) => [t.account.number, t.debitOre, t.creditOre] as const)).toEqual([
    ['1510', 900_000, 900_000],
    ['1930', 900_000, 0],
    ['3911', 0, 900_000],
  ])
  expect(preview.overlapping).toEqual([])
})

test('an export writes a SIE 4 file, records it, and later overlapping periods are flagged', async () => {
  const { run } = harness()
  await paidAvi(run)
  const file = await run(exportSie(everything))
  expect(file.voucherCount).toBe(2)
  expect(file.fileName).toEndWith('_2000-01-01_2099-12-31.se')
  const text = decode(file.base64)
  expect(text).toContain('#SIETYP 4\r\n')
  expect(text).toContain('#FORMAT PC8\r\n')
  expect(text).toContain('#KONTO 1510 "Kundfordringar"')
  expect(text).toMatch(/#VER "F" "1" \d{8} "[^"]*Anna"/)
  expect(text).toContain('#TRANS 3911 {} -9000.00')

  const [recorded] = await run(listExports)
  expect(recorded).toMatchObject({ ...everything, voucherCount: 2, exportedBy: 'u' })
  const again = await run(previewExport({ fromDate: today, toDate: today }))
  expect(again.overlapping.map((e) => e.id)).toEqual([recorded.id])
})

test('the company can use its own account numbers and financial year', async () => {
  const { run, sqlite } = harness()
  await paidAvi(run)
  const defaults = await run(getBookkeepingSettings)
  const accounts = Object.fromEntries(
    Object.entries(defaults.accounts).map(([key, a]) => [key, a.number]),
  ) as Record<keyof typeof defaults.accounts, string>
  const updated = await run(
    updateBookkeepingSettings({
      financialYearStartMonth: '7',
      accounts: { ...accounts, rent: '3010', bank: '1940' },
    }),
  )
  expect(updated.financialYearStartMonth).toBe(7)
  expect(updated.accounts.rent.number).toBe('3010')
  // Only the numbers that differ from BAS are stored.
  const stored = sqlite
    .query('select bookkeeping_accounts as a from organization_settings')
    .get() as {
    a: string
  }
  expect(JSON.parse(stored.a)).toEqual({ bank: '1940', rent: '3010' })

  const text = decode((await run(exportSie(everything))).base64)
  expect(text).toContain('#TRANS 3010 {} -9000.00')
  expect(text).toContain('#TRANS 1940 {} 9000.00')
  expect(text).toMatch(/#RAR 0 \d{4}0701 \d{4}0630/)
})

test('an empty or backwards period has nothing to export', async () => {
  const { run } = harness()
  await paidAvi(run)
  expect(await fail(run(exportSie({ fromDate: '2001-01-01', toDate: '2001-12-31' })))).toContain(
    'inget att exportera',
  )
  expect(
    await fail(run(previewExport({ fromDate: '2001-02-01', toDate: '2001-01-01' }))),
  ).toContain('slutar före')
  expect(await run(listExports)).toEqual([])
})
