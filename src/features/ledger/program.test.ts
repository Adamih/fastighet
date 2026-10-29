import { expect, test } from 'bun:test'
import { partyAccount, refundCredit, undoCreditRefund } from '#/features/accounts/program'
import {
  createCreditNote,
  createInvoiceRun,
  getInvoice,
  listInvoices,
  markInvoicePaid,
  unmarkInvoicePaid,
  voidInvoice,
} from '#/features/invoicing/program'
import { createLease } from '#/features/leases/program'
import { buildCamt054 } from '#/features/payments/camt054-builder'
import {
  assignPayment,
  importPayments,
  listPayments,
  previewAssignment,
  undoPayment,
} from '#/features/payments/program'
import { addMonths, stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'
import { invoiceMoneyFor } from './program'

// Money end to end through the programs: an invoice run posts the avi, payments and credits post
// against it, what is left over is the tenant's credit balance, and every status comes from the
// ledger.

const today = stockholmDate(Date.now())
const month = (n: number) => addMonths(`${today.slice(0, 7)}-01`, n).slice(0, 7)

/** One lease at 9 000 kr a month for Anna. */
async function lease(run: ReturnType<typeof harness>['run']) {
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
}

/** Invoices the month `n` months ahead and returns the new avi. */
async function invoiceMonth(run: ReturnType<typeof harness>['run'], n: number) {
  await run(createInvoiceRun({ month: month(n), send: false }))
  const all = await run(listInvoices({ filter: 'all' }))
  return all.reduce((a, b) => (a.number > b.number ? a : b))
}

let file = 0
const bankFile = (payments: { amountOre: number; ocr: string | null }[]) =>
  buildCamt054({
    messageId: `MSG-${++file}`,
    bankgiro: '9900002',
    payments: payments.map((p, i) => ({
      bookingDate: today,
      amountOre: p.amountOre,
      ocr: p.ocr ?? undefined,
      payerName: 'ANNA',
      bankReference: `REF-${file}-${i}`,
    })),
  })

const pay = (run: ReturnType<typeof harness>['run'], amountOre: number, ocr: string | null) =>
  run(importPayments({ fileName: 'b.xml', content: bankFile([{ amountOre, ocr }]) }))

test('an invoice run posts the avi: owed in full until paid', async () => {
  const { run, sqlite } = harness()
  await lease(run)
  const avi = await invoiceMonth(run, 1)
  expect(avi).toMatchObject({ totalOre: 900_000, owedOre: 900_000, paidOre: 0, status: 'unpaid' })
  const sums = sqlite
    .query('select sum(amount_ore) as s from ledger_entry group by posting_id')
    .all() as { s: number }[]
  expect(sums.every((r) => r.s === 0)).toBe(true)
})

test('a payment by hand settles the avi; undoing it reopens it', async () => {
  const { run } = harness()
  await lease(run)
  const avi = await invoiceMonth(run, 1)
  const paid = await run(markInvoicePaid({ invoiceId: avi.id, paidOn: today }))
  expect(paid).toMatchObject({ status: 'paid', owedOre: 0, paidOn: today })
  const undone = await run(unmarkInvoicePaid(avi.id))
  expect(undone).toMatchObject({ status: 'unpaid', owedOre: 900_000, paidOre: 0 })
})

test('one payment with the newer avi’s OCR pays both months', async () => {
  const { run } = harness()
  await lease(run)
  const first = await invoiceMonth(run, 1)
  const second = await invoiceMonth(run, 2)
  expect(await pay(run, 1_800_000, second.ocr)).toMatchObject({ matched: 1, toCredit: 0 })
  expect(await run(getInvoice(first.id))).toMatchObject({ status: 'paid' })
  expect(await run(getInvoice(second.id))).toMatchObject({ status: 'paid' })
  const [p] = await run(listPayments('matched'))
  expect(p.allocations.map((a) => [a.number, a.amountOre])).toEqual([
    [second.number, 900_000],
    [first.number, 900_000],
  ])

  // "Ångra betalning" on one avi undoes the whole payment, on both.
  await run(unmarkInvoicePaid(first.id))
  expect(await run(getInvoice(second.id))).toMatchObject({ status: 'unpaid', owedOre: 900_000 })
  expect((await run(listPayments('attention')))[0]).toMatchObject({ unallocatedOre: 1_800_000 })
})

test('a part payment lowers what is owed, and the rest completes it', async () => {
  const { run } = harness()
  await lease(run)
  const avi = await invoiceMonth(run, 1)
  await pay(run, 400_000, avi.ocr)
  expect(await run(getInvoice(avi.id))).toMatchObject({ status: 'unpaid', owedOre: 500_000 })
  await pay(run, 500_000, avi.ocr)
  expect(await run(getInvoice(avi.id))).toMatchObject({ status: 'paid', paidOre: 900_000 })
})

test('paying too much leaves credit, which the next avi uses', async () => {
  const { run } = harness()
  await lease(run)
  const avi = await invoiceMonth(run, 1)
  expect(await pay(run, 950_000, avi.ocr)).toMatchObject({ matched: 1, toCredit: 1 })
  expect(await run(getInvoice(avi.id))).toMatchObject({ status: 'paid', owedOre: 0 })
  expect(await run(partyAccount('anna'))).toMatchObject({ creditOre: 50_000, owedOre: 0 })

  const next = await invoiceMonth(run, 2)
  expect(next).toMatchObject({ totalOre: 900_000, creditUsedOre: 50_000, owedOre: 850_000 })
  expect(await run(partyAccount('anna'))).toMatchObject({ creditOre: 0, owedOre: 850_000 })

  // The overpayment can't be undone once its credit has been used.
  const [p] = await run(listPayments('matched'))
  expect(await fail(run(undoPayment(p.id)))).toContain('redan räknats av')

  // Voiding the unsent avi gives the credit back.
  await run(voidInvoice(next.id))
  expect(await run(partyAccount('anna'))).toMatchObject({ creditOre: 50_000 })
})

test('a credit after payment becomes credit, which can be paid back and undone', async () => {
  const { run } = harness()
  await lease(run)
  const avi = await invoiceMonth(run, 1)
  await run(markInvoicePaid({ invoiceId: avi.id, paidOn: today }))
  await run(
    createCreditNote({ invoiceId: avi.id, kind: 'amount', netOre: 100_000, reason: 'Vattenskada' }),
  )
  expect(await run(getInvoice(avi.id))).toMatchObject({
    status: 'paid',
    owedOre: 0,
    creditedOre: 100_000,
    toCreditOre: 100_000,
  })
  expect((await run(partyAccount('anna'))).creditOre).toBe(100_000)

  expect(await fail(run(refundCredit({ partyId: 'anna', refundedOn: '2999-01-01' })))).toContain(
    'framtiden',
  )
  await run(refundCredit({ partyId: 'anna', refundedOn: today }))
  const refunded = await run(partyAccount('anna'))
  expect(refunded).toMatchObject({ creditOre: 0, lastRefund: { amountOre: 100_000 } })
  expect(refunded.history[0]).toMatchObject({ kind: 'refund', amountOre: 100_000, balanceOre: 0 })
  await run(undoCreditRefund('anna'))
  expect(await run(partyAccount('anna'))).toMatchObject({ creditOre: 100_000, lastRefund: null })
})

test('a payment without OCR waits; matched to the tenant it settles oldest first', async () => {
  const { run } = harness()
  await lease(run)
  const first = await invoiceMonth(run, 1)
  const second = await invoiceMonth(run, 2)
  expect(await pay(run, 1_000_000, null)).toMatchObject({ matched: 0, unmatched: 1 })
  const [waiting] = await run(listPayments('attention'))
  const plan = await run(previewAssignment({ paymentId: waiting.id, partyId: 'anna' }))
  expect(plan.map((a) => [a.number, a.amountOre])).toEqual([
    [first.number, 900_000],
    [second.number, 100_000],
  ])
  await run(assignPayment({ paymentId: waiting.id, partyId: 'anna' }))
  expect(await run(getInvoice(first.id))).toMatchObject({ status: 'paid' })
  expect(await run(getInvoice(second.id))).toMatchObject({ owedOre: 800_000 })
  expect(await fail(run(assignPayment({ paymentId: waiting.id, partyId: 'anna' })))).toContain(
    'redan kopplad',
  )
  await run(undoPayment(waiting.id))
  expect(await run(getInvoice(first.id))).toMatchObject({ status: 'unpaid' })
})

test('an avi without receivable entries owes nothing, rather than being missing', async () => {
  const { run } = harness()
  const moneyOf = await run(invoiceMoneyFor(['no-such-avi']))
  expect(moneyOf('no-such-avi')).toMatchObject({ owedOre: 0, paidOre: 0, paidOn: null })
  expect(moneyOf('never-asked')).toMatchObject({ owedOre: 0 })
})
