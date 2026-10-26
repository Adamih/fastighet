import { expect, test } from 'bun:test'
import { createInvoiceRun, getInvoice, listInvoices } from '#/features/invoicing/program'
import { createLease } from '#/features/leases/program'
import { addDays, addMonths, stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'
import { reminderCandidates, sendReminder, sendReminders } from './program'

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
