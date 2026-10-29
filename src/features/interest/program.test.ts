import { expect, test } from 'bun:test'
import { markInvoicePaid } from '#/features/invoicing/payment-program'
import { getInvoice, listInvoices } from '#/features/invoicing/program'
import { createInvoiceRun } from '#/features/invoicing/run-program'
import { createLease } from '#/features/leases/program'
import { buildCamt054 } from '#/features/payments/camt054-builder'
import { importPayments } from '#/features/payments/program'
import { addDays, addMonths, stockholmDate } from '#/lib/dates'
import { harness } from '#/test/harness'

const today = stockholmDate(Date.now())
const month = (offset: number) => addMonths(`${today.slice(0, 7)}-01`, offset).slice(0, 7)

/**
 * A 9 000 kr avi that fell due 20 days ago, in a company that charges late interest at 2 %
 * reference rate (10 % in all).
 */
async function lateAvi(h: ReturnType<typeof harness>) {
  const half = `${today.slice(0, 4)}-${today.slice(5, 7) <= '06' ? '01' : '07'}-01`
  h.sqlite.exec(`
    UPDATE organization_settings SET late_interest = 1;
    INSERT OR REPLACE INTO reference_rate (from_date, basis_points) VALUES ('${half}', 200);
    INSERT OR REPLACE INTO reference_rate (from_date, basis_points)
      VALUES ('${addMonths(half, -6)}', 200);
  `)
  const { id: leaseId } = await h.run(
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
  await h.run(createInvoiceRun({ month: month(1), send: false }))
  const [avi] = await h.run(listInvoices({ filter: 'all' }))
  h.sqlite.exec(`
    UPDATE invoice SET due_date = '${addDays(today, -20)}' WHERE id = '${avi.id}';
    UPDATE posting SET date = '${addDays(today, -40)}' WHERE kind = 'invoice';
  `)
  return { ...(await h.run(getInvoice(avi.id))), leaseId }
}

let file = 0
const pay = (h: ReturnType<typeof harness>, ocr: string, amountOre: number, bookingDate: string) =>
  h.run(
    importPayments({
      fileName: 'b.xml',
      content: buildCamt054({
        messageId: `MSG-${++file}`,
        bankgiro: '9900002',
        payments: [{ bookingDate, amountOre, ocr, bankReference: `REF-${file}` }],
      }),
    }),
  )

const interestCharges = (h: ReturnType<typeof harness>) =>
  h.sqlite
    .query(
      "SELECT amount_ore AS ore, description, from_date AS fromDate FROM charge WHERE kind = 'late_interest'",
    )
    .all() as { ore: number; description: string; fromDate: string }[]

test('an avi paid late gets interest as a one-off charge, which the next avi bills', async () => {
  const h = harness()
  const avi = await lateAvi(h)
  // Paid 10 days late: 9 000 kr × 10 % × 10 / 365 = 24,66 kr → 24 kr.
  await pay(h, avi.ocr, 900_000, addDays(today, -10))
  const paid = await h.run(getInvoice(avi.id))
  // The late avi itself stays paid.
  expect(paid).toMatchObject({ status: 'paid', owedOre: 0 })
  expect(paid.lateInterest).toMatchObject({
    amountOre: 2_400,
    days: 10,
    fromDate: addDays(today, -19),
    toDate: addDays(today, -10),
    billedBy: null,
  })
  expect(interestCharges(h)).toEqual([
    { ore: 2_400, description: `Dröjsmålsränta avi ${avi.number}, 10 dagar`, fromDate: today },
  ])

  await h.run(createInvoiceRun({ month: month(2), send: false }))
  const [next] = await h.run(listInvoices({ filter: 'all' }))
  const billing = await h.run(getInvoice(next.id))
  expect(billing.lines.map((l) => [l.kind, l.netOre, l.vatOre])).toContainEqual([
    'late_interest',
    2_400,
    0,
  ])
  expect((await h.run(getInvoice(avi.id))).lateInterest?.billedBy).toEqual({
    id: next.id,
    number: next.number,
  })
})

test('nothing until the avi is settled, and nothing for an avi paid on time', async () => {
  const h = harness()
  const avi = await lateAvi(h)
  await pay(h, avi.ocr, 500_000, addDays(today, -10))
  expect(interestCharges(h)).toEqual([])
  // The rest arrives 10 days later: 9 000 kr for 10 days, then 4 000 kr for 10.
  await pay(h, avi.ocr, 400_000, today)
  // (9 000 × 10 + 4 000 × 10) × 10 % / 365 = 35,62 kr → 35 kr; the day it's paid counts.
  expect(interestCharges(h).map((c) => c.ore)).toEqual([3_500])

  const onTime = harness()
  const avi2 = await lateAvi(onTime)
  await pay(onTime, avi2.ocr, 900_000, addDays(today, -20))
  expect(interestCharges(onTime)).toEqual([])
})

test('only when the company charges it, above its minimum, and while the agreement runs', async () => {
  const off = harness()
  const avi = await lateAvi(off)
  off.sqlite.exec('UPDATE organization_settings SET late_interest = 0')
  await pay(off, avi.ocr, 900_000, addDays(today, -10))
  expect(interestCharges(off)).toEqual([])

  const minimum = harness()
  const avi2 = await lateAvi(minimum)
  minimum.sqlite.exec('UPDATE organization_settings SET late_interest_minimum_ore = 5000')
  await pay(minimum, avi2.ocr, 900_000, addDays(today, -10))
  expect(interestCharges(minimum)).toEqual([])

  const ended = harness()
  const avi3 = await lateAvi(ended)
  ended.sqlite.exec(`UPDATE agreement SET end_date = '${addDays(today, -1)}'`)
  await pay(ended, avi3.ocr, 900_000, addDays(today, -10))
  expect(interestCharges(ended)).toEqual([])
})

test('a payment by hand dated late charges interest too, once', async () => {
  const h = harness()
  const avi = await lateAvi(h)
  await h.run(markInvoicePaid({ invoiceId: avi.id, paidOn: addDays(today, -10) }))
  expect(interestCharges(h).map((c) => c.ore)).toEqual([2_400])
  // Another payment (e.g. a duplicate, to credit) doesn't charge it again.
  await pay(h, avi.ocr, 900_000, today)
  expect(interestCharges(h).map((c) => c.ore)).toEqual([2_400])
})
