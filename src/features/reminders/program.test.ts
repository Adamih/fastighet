import { expect, test } from 'bun:test'
import { removeOneOffCharge } from '#/features/agreements/program'
import {
  createInvoiceRun,
  getInvoice,
  listInvoices,
  markInvoicePaid,
} from '#/features/invoicing/program'
import { createLease } from '#/features/leases/program'
import { buildCamt054 } from '#/features/payments/camt054-builder'
import { importPayments } from '#/features/payments/program'
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
  expect(avi).toMatchObject({ owedOre: 900_000, status: 'overdue' })
  expect(avi.reminders.map((r) => [r.sequence, r.owedOre, r.feeOre])).toEqual([[1, 900_000, 6_000]])
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
  expect((await h.run(getInvoice(id))).owedOre).toBe(900_000)
  expect(
    h.sqlite.query("SELECT count(*) AS n FROM charge WHERE kind = 'reminder_fee'").get(),
  ).toEqual({ n: 1 })
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
    UPDATE posting SET date = '${addDays(today, -40)}' WHERE kind = 'invoice';
  `)
}

const feeCharges = (h: ReturnType<typeof harness>) =>
  h.sqlite
    .query("SELECT amount_ore AS ore, description FROM charge WHERE kind = 'reminder_fee'")
    .all() as { ore: number; description: string }[]

test('the fee is a charge for the next avi; the reminded avi keeps its own amount', async () => {
  const h = harness()
  const avi = await reminded(h)
  expect(avi).toMatchObject({ owedOre: 900_000, status: 'overdue' })
  expect(avi.reminders[0]).toMatchObject({ owedOre: 900_000, feeOre: 6_000, feeBilledBy: null })
  expect(feeCharges(h)).toEqual([{ ore: 6_000, description: `Påminnelseavgift avi ${avi.number}` }])
  expect(h.outbox.at(-1)?.text).toContain('läggs på din nästa hyresavi')

  // Paying the avi settles it; the fee waits for the next avi, which bills it.
  remindedDaysAgo(h, 3)
  await pay(h, avi.ocr, 900_000, today)
  expect((await h.run(getInvoice(avi.id))).status).toBe('paid')
  await h.run(
    createInvoiceRun({ month: addMonths(`${today.slice(0, 7)}-01`, 2).slice(0, 7), send: false }),
  )
  const [next] = await h.run(listInvoices({ filter: 'all' }))
  const billing = await h.run(getInvoice(next.id))
  expect(billing.lines.map((l) => [l.kind, l.netOre, l.vatOre])).toContainEqual([
    'reminder_fee',
    6_000,
    0,
  ])
  const after = await h.run(getInvoice(avi.id))
  expect(after.reminders[0]?.feeBilledBy).toEqual({ id: next.id, number: next.number })
  expect(await fail(h.run(waiveReminderFee(avi.id)))).toContain(`aviserad på avi ${next.number}`)
})

test('a payment booked before the reminder went out, imported after, waives its fee', async () => {
  const h = harness()
  const avi = await reminded(h)
  await pay(h, avi.ocr, 900_000, addDays(today, -2))
  const after = await h.run(getInvoice(avi.id))
  expect(after).toMatchObject({ status: 'paid', owedOre: 0 })
  expect(after.reminders[0]).toMatchObject({
    feeWaivedOn: today,
    feeWaiver: 'paid_before_reminder',
    feeChargeId: null,
  })
  expect(feeCharges(h)).toEqual([])
})

test('the same payment by hand, dated before the reminder, waives the fee', async () => {
  const h = harness()
  const avi = await reminded(h)
  const after = await h.run(markInvoicePaid({ invoiceId: avi.id, paidOn: addDays(today, -1) }))
  expect(after).toMatchObject({ status: 'paid', owedOre: 0, paidOre: 900_000 })
  expect(after.reminders[0]?.feeWaiver).toBe('paid_before_reminder')
  expect(feeCharges(h)).toEqual([])
})

test('a fee waits for the next avi until someone waives it', async () => {
  const h = harness()
  const avi = await reminded(h)
  remindedDaysAgo(h, 3)
  await pay(h, avi.ocr, 900_000, today)
  expect(feeCharges(h)).toHaveLength(1)

  await h.run(waiveReminderFee(avi.id))
  const waived = await h.run(getInvoice(avi.id))
  expect(waived.reminders[0]).toMatchObject({ feeWaivedOn: today, feeWaiver: 'by_hand' })
  expect(feeCharges(h)).toEqual([])
  expect(await fail(h.run(waiveReminderFee(avi.id)))).toContain('ingen påminnelseavgift')
})

test('removing the fee’s charge on the agreement waives it too', async () => {
  const h = harness()
  const avi = await reminded(h)
  const [{ id }] = h.sqlite.query("SELECT id FROM charge WHERE kind = 'reminder_fee'").all() as {
    id: string
  }[]
  await h.run(removeOneOffCharge(id))
  expect((await h.run(getInvoice(avi.id))).reminders[0]).toMatchObject({
    feeWaiver: 'by_hand',
    feeChargeId: null,
  })
})

test('a company can waive the fee when the avi is paid by the reminder’s due date', async () => {
  const h = harness()
  h.sqlite.exec('UPDATE organization_settings SET waive_reminder_fee_by_due_date = 1')
  const avi = await reminded(h)
  remindedDaysAgo(h, 3)
  await pay(h, avi.ocr, 900_000, today)
  expect((await h.run(getInvoice(avi.id))).reminders[0]?.feeWaiver).toBe('paid_by_due_date')
  expect(feeCharges(h)).toEqual([])
})

test('no fee on an agreement that has ended: there is no next avi to bill it', async () => {
  const h = harness()
  const id = await overdueAvi(h)
  h.sqlite.exec(`UPDATE agreement SET end_date = '${addDays(today, -1)}'`)
  expect(await h.run(sendReminder(id))).toMatchObject({ feeOre: 0 })
  expect(feeCharges(h)).toEqual([])
})
