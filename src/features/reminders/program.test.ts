import { expect, test } from 'bun:test'
import { partyAccount } from '#/features/accounts/program'
import {
  createInvoiceRun,
  getInvoice,
  listInvoices,
  markInvoicePaid,
} from '#/features/invoicing/program'
import { createLease } from '#/features/leases/program'
import { buildCamt054 } from '#/features/payments/camt054-builder'
import { importPayments, listPayments } from '#/features/payments/program'
import { addDays, addMonths, stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'
import { reminderCandidates, sendReminder, sendReminders, waiveReminderFee } from './program'

const today = stockholmDate(Date.now())

/** An avi for 9 000 kr that fell due three weeks ago, to a tenant with an email address. */
async function overdueAvi(h: ReturnType<typeof harness>) {
  h.sqlite.exec(`
    UPDATE party SET email = 'anna@example.test' WHERE id = 'anna';
    UPDATE organization_settings SET reminder_fee_ore = 6000;
  `)
  await h.run(
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
  await h.run(
    createInvoiceRun({ month: addMonths(`${today.slice(0, 7)}-01`, 1).slice(0, 7), send: false }),
  )
  const [avi] = await h.run(listInvoices({ filter: 'all' }))
  h.sqlite.exec(`UPDATE invoice SET due_date = '${addDays(today, -21)}' WHERE id = '${avi.id}'`)
  return avi.id
}

test('a reminder asks for what is owed plus the fee, and the fee is owed on the avi', async () => {
  const h = harness()
  const id = await overdueAvi(h)
  const [candidate] = await h.run(reminderCandidates)
  expect(candidate).toMatchObject({ invoiceId: id, problem: null, feeOre: 6_000 })

  const sent = await h.run(sendReminder(id))
  expect(sent).toMatchObject({ sequence: 1, feeOre: 6_000 })
  expect(h.outbox.at(-1)?.subject).toStartWith('Påminnelse: hyresavi')
  const avi = await h.run(getInvoice(id))
  expect(avi).toMatchObject({ owedOre: 906_000, status: 'overdue' })
  expect(avi.reminders.map((r) => [r.sequence, r.owedOre, r.feeOre])).toEqual([[1, 906_000, 6_000]])
  const [listed] = await h.run(listInvoices({ filter: 'overdue' }))
  expect(listed.lastRemindedOn).toBe(today)
})

test('the next reminder waits the interval, and carries no second fee', async () => {
  const h = harness()
  const id = await overdueAvi(h)
  await h.run(sendReminder(id))
  expect(await fail(h.run(sendReminder(id)))).toContain('för tidigt')
  h.sqlite.exec(`UPDATE payment_reminder SET sent_on = '${addDays(today, -11)}'`)
  const second = await h.run(sendReminder(id))
  expect(second).toMatchObject({ sequence: 2, feeOre: 0 })
  expect((await h.run(getInvoice(id))).owedOre).toBe(906_000)
})

test('sending in bulk reports what failed without stopping the rest', async () => {
  const h = harness()
  const id = await overdueAvi(h)
  const result = await h.run(sendReminders([id, 'missing']))
  expect(result).toMatchObject({ sent: 1, failed: 1, failedInvoiceIds: ['missing'] })
})

let file = 0
/** Imports a bank file with one payment to `ocr`, booked on `bookingDate`. */
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

/** An overdue avi reminded today with the 60 kr fee. */
async function reminded(h: ReturnType<typeof harness>) {
  const id = await overdueAvi(h)
  await h.run(sendReminder(id))
  return h.run(getInvoice(id))
}

/** Moves the reminder (and the avi, issued before it) `days` back. */
function remindedDaysAgo(h: ReturnType<typeof harness>, days: number) {
  h.sqlite.exec(`
    UPDATE payment_reminder SET sent_on = '${addDays(today, -days)}';
    UPDATE posting SET date = '${addDays(today, -days)}' WHERE kind = 'reminder';
    UPDATE posting SET date = '${addDays(today, -40)}' WHERE kind = 'invoice';
  `)
}

test('a payment booked before the reminder went out, imported after, waives its fee', async () => {
  const h = harness()
  const avi = await reminded(h)
  await pay(h, avi.ocr, 900_000, addDays(today, -2))
  const after = await h.run(getInvoice(avi.id))
  expect(after).toMatchObject({ status: 'paid', owedOre: 0, paidOre: 900_000 })
  expect(after.reminders[0]).toMatchObject({
    feeWaivedOn: today,
    feeWaiver: 'paid_before_reminder',
  })
  // The fee's posting is reversed, so it isn't income either.
  const income = h.sqlite
    .query(
      "SELECT sum(amount_ore) AS ore FROM ledger_entry WHERE account = 'income' AND charge_kind = 'reminder_fee'",
    )
    .get() as { ore: number }
  expect(income.ore).toBe(0)
})

test('the same payment by hand, dated before the reminder, pays the avi without the fee', async () => {
  const h = harness()
  const avi = await reminded(h)
  const after = await h.run(markInvoicePaid({ invoiceId: avi.id, paidOn: addDays(today, -1) }))
  expect(after).toMatchObject({ status: 'paid', owedOre: 0, paidOre: 900_000 })
  expect(after.reminders[0]?.feeWaiver).toBe('paid_before_reminder')
})

test('paying the avi but not the fee after the reminder leaves the fee, which can be waived', async () => {
  const h = harness()
  const avi = await reminded(h)
  await pay(h, avi.ocr, 900_000, today)
  // Booked the day the reminder went out: it may have crossed the reminder, so the fee goes.
  expect((await h.run(getInvoice(avi.id))).reminders[0]?.feeWaiver).toBe('paid_before_reminder')

  const h2 = harness()
  const avi2 = await reminded(h2)
  remindedDaysAgo(h2, 3)
  await pay(h2, avi2.ocr, 900_000, today)
  const left = await h2.run(getInvoice(avi2.id))
  expect(left).toMatchObject({ status: 'overdue', owedOre: 6_000 })
  expect(left.reminders[0]?.feeWaivedOn).toBeNull()
  const [payment] = await h2.run(listPayments('matched'))
  expect(payment.allocations).toEqual([
    expect.objectContaining({ invoiceId: avi2.id, amountOre: 900_000, feeLeftOre: 6_000 }),
  ])

  await h2.run(waiveReminderFee(avi2.id))
  const waived = await h2.run(getInvoice(avi2.id))
  expect(waived).toMatchObject({ status: 'paid', owedOre: 0 })
  expect(waived.reminders[0]).toMatchObject({ feeWaivedOn: today, feeWaiver: 'by_hand' })
  expect(await fail(h2.run(waiveReminderFee(avi2.id)))).toContain('ingen påminnelseavgift')
  const [listed] = await h2.run(listPayments('matched'))
  expect(listed.allocations[0]?.feeLeftOre).toBe(0)
})

test('a company can waive the fee when the avi is paid by the reminder’s due date', async () => {
  const h = harness()
  h.sqlite.exec('UPDATE organization_settings SET waive_reminder_fee_by_due_date = 1')
  const avi = await reminded(h)
  remindedDaysAgo(h, 3)
  await pay(h, avi.ocr, 900_000, today)
  const after = await h.run(getInvoice(avi.id))
  expect(after).toMatchObject({ status: 'paid', owedOre: 0 })
  expect(after.reminders[0]?.feeWaiver).toBe('paid_by_due_date')
})

test('waiving a fee that was already paid moves it to the payer’s credit', async () => {
  const h = harness()
  const avi = await reminded(h)
  remindedDaysAgo(h, 3)
  await pay(h, avi.ocr, 906_000, today)
  expect((await h.run(getInvoice(avi.id))).status).toBe('paid')
  await h.run(waiveReminderFee(avi.id))
  const after = await h.run(getInvoice(avi.id))
  expect(after).toMatchObject({ status: 'paid', owedOre: 0, toCreditOre: 6_000 })
  expect((await h.run(partyAccount('anna'))).creditOre).toBe(6_000)
})
