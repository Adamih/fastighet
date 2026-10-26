import { expect, test } from 'bun:test'
import {
  createCreditNote,
  createInvoiceRun,
  getInvoice,
  listInvoices,
  markInvoicePaid,
  refundInvoice,
  undoInvoiceRefund,
  unmarkInvoicePaid,
} from '#/features/invoicing/program'
import { createLease } from '#/features/leases/program'
import { buildCamt054 } from '#/features/payments/camt054-builder'
import {
  assignPayment,
  importPayments,
  listPayments,
  undoPayment,
} from '#/features/payments/program'
import { addMonths, stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'

// Money end to end through the programs: an invoice run posts the avi, payments and credits post
// against it, and every status comes from the ledger.

const today = stockholmDate(Date.now())
const nextMonth = addMonths(`${today.slice(0, 7)}-01`, 1).slice(0, 7)

/** One lease at 9 000 kr a month, invoiced for next month. Returns the avi. */
async function invoicedLease(run: ReturnType<typeof harness>['run']) {
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
  return avi
}

const bankFile = (payments: { amountOre: number; ocr: string; ref: string }[]) =>
  buildCamt054({
    messageId: `MSG-${payments.map((p) => p.ref).join('-')}`,
    bankgiro: '9900002',
    payments: payments.map((p) => ({
      bookingDate: today,
      amountOre: p.amountOre,
      ocr: p.ocr,
      payerName: 'ANNA',
      bankReference: p.ref,
    })),
  })

test('an invoice run posts the avi: owed in full until paid', async () => {
  const { run, sqlite } = harness()
  const avi = await invoicedLease(run)
  expect(avi).toMatchObject({ totalOre: 900_000, owedOre: 900_000, paidOre: 0, status: 'unpaid' })
  const sums = sqlite
    .query('select sum(amount_ore) as s from ledger_entry group by posting_id')
    .all() as { s: number }[]
  expect(sums.every((r) => r.s === 0)).toBe(true)
})

test('a payment by hand settles the avi; undoing it reopens it', async () => {
  const { run } = harness()
  const avi = await invoicedLease(run)
  const paid = await run(markInvoicePaid({ invoiceId: avi.id, paidOn: today }))
  expect(paid).toMatchObject({ status: 'paid', owedOre: 0, paidOn: today })
  expect(paid.payments).toHaveLength(1)
  const undone = await run(unmarkInvoicePaid(avi.id))
  expect(undone).toMatchObject({ status: 'unpaid', owedOre: 900_000, paidOre: 0 })
})

test('a credit after payment is paid back; undoing the refund makes it due again', async () => {
  const { run } = harness()
  const avi = await invoicedLease(run)
  await run(markInvoicePaid({ invoiceId: avi.id, paidOn: today }))
  await run(
    createCreditNote({ invoiceId: avi.id, kind: 'amount', netOre: 100_000, reason: 'Vattenskada' }),
  )
  const credited = await run(getInvoice(avi.id))
  expect(credited).toMatchObject({ status: 'paid', refundDueOre: 100_000, creditedOre: 100_000 })
  const refunded = await run(refundInvoice({ invoiceId: avi.id, refundedOn: today }))
  expect(refunded).toMatchObject({ refundDueOre: 0, refundedOre: 100_000 })
  expect(refunded.refunds).toEqual([{ date: today, amountOre: 100_000 }])
  expect(await fail(run(unmarkInvoicePaid(avi.id)))).toContain('Ångra återbetalningen först')
  const undone = await run(undoInvoiceRefund(avi.id))
  expect(undone).toMatchObject({ refundDueOre: 100_000, refundedOre: 0 })
})

test('a part payment waits for a person, and the rest then matches by itself', async () => {
  const { run } = harness()
  const avi = await invoicedLease(run)
  const first = await run(
    importPayments({
      fileName: 'a.xml',
      content: bankFile([{ amountOre: 400_000, ocr: avi.ocr, ref: 'A1' }]),
    }),
  )
  expect(first).toMatchObject({ imported: 1, review: 1, matched: 0 })
  const [waiting] = await run(listPayments('attention'))
  expect(waiting).toMatchObject({ unallocatedOre: 400_000, invoice: { id: avi.id } })

  // Matched by hand, the part payment lowers what is owed but doesn't settle the avi.
  await run(assignPayment({ paymentId: waiting.id, invoiceId: avi.id }))
  expect(await run(getInvoice(avi.id))).toMatchObject({
    status: 'unpaid',
    owedOre: 500_000,
    paidOre: 400_000,
  })

  // The rest, with the same OCR and exactly what is owed, is booked automatically.
  const second = await run(
    importPayments({
      fileName: 'b.xml',
      content: bankFile([{ amountOre: 500_000, ocr: avi.ocr, ref: 'B1' }]),
    }),
  )
  expect(second).toMatchObject({ matched: 1 })
  const paid = await run(getInvoice(avi.id))
  expect(paid).toMatchObject({ status: 'paid', owedOre: 0, paidOre: 900_000 })
  expect(paid.payments.map((p) => p.amountOre)).toEqual([400_000, 500_000])

  // Undoing the first payment reopens what it paid and puts it back for handling.
  await run(undoPayment(waiting.id))
  expect(await run(getInvoice(avi.id))).toMatchObject({ status: 'unpaid', owedOre: 400_000 })
  const [again] = await run(listPayments('attention'))
  expect(again).toMatchObject({ id: waiting.id, status: 'unmatched', unallocatedOre: 400_000 })
})
