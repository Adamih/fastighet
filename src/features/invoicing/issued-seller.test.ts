import { expect, test } from 'bun:test'
import { createLease } from '#/features/leases/program'
import { sendReminder } from '#/features/reminders/program'
import { addDays, addMonths, stockholmDate } from '#/lib/dates'
import { harness } from '#/test/harness'
import { createCreditNote, getCreditNote } from './credit-program'
import { getInvoice, listInvoices } from './program'
import { createInvoiceRun } from './run-program'
import { emailCreditNote, emailInvoice } from './send-program'

// Avier and credit notes keep the seller as they were issued: bankgiro, name, address, org.nr and
// F-skatt. Changing the company details afterwards changes new documents only.

const today = stockholmDate(Date.now())

/** One avi for Anna, issued while the company is "Test" with bankgiro 990-0002. */
async function issuedAvi(h: ReturnType<typeof harness>) {
  h.sqlite.exec(`
    UPDATE party SET email = 'anna@example.test' WHERE id = 'anna';
    UPDATE organization_settings
      SET street_address = 'Gamla gatan 1', postal_code = '75320', city = 'Uppsala';
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
  return avi.id
}

/** The company moves and changes bankgiro. */
const changeDetails = (h: ReturnType<typeof harness>) =>
  h.sqlite.exec(
    `UPDATE organization_settings SET bankgiro = '5050-1055', street_address = 'Nya gatan 2'`,
  )

test('an avi keeps the seller it was issued with, on its page and in its email', async () => {
  const h = harness()
  const id = await issuedAvi(h)
  changeDetails(h)

  const avi = await h.run(getInvoice(id))
  expect(avi.seller).toMatchObject({ bankgiro: '990-0002', streetAddress: 'Gamla gatan 1' })
  await h.run(emailInvoice(id))
  const email = h.outbox.at(-1)?.text
  expect(email).toContain('990-0002')
  expect(email).toContain('Gamla gatan 1')
  expect(email).not.toContain('5050-1055')
})

test('a credit note is issued with the seller as it is then, and keeps it', async () => {
  const h = harness()
  const id = await issuedAvi(h)
  changeDetails(h)
  const { id: noteId } = await h.run(
    createCreditNote({ invoiceId: id, kind: 'amount', netOre: 100_000, reason: 'Vattenskada' }),
  )
  h.sqlite.exec(`UPDATE organization_settings SET street_address = 'Tredje gatan 3'`)

  const note = await h.run(getCreditNote(noteId))
  expect(note.seller).toMatchObject({ bankgiro: '5050-1055', streetAddress: 'Nya gatan 2' })
  await h.run(emailCreditNote(noteId))
  expect(h.outbox.at(-1)?.text).toContain('Nya gatan 2')
})

test('a reminder asks for payment to the bankgiro the company has now', async () => {
  const h = harness()
  const id = await issuedAvi(h)
  h.sqlite.exec(`UPDATE invoice SET due_date = '${addDays(today, -21)}' WHERE id = '${id}'`)
  changeDetails(h)
  await h.run(sendReminder(id))
  expect(h.outbox.at(-1)?.text).toContain('5050-1055')
})

test('an avi issued before the seller was stored shows the current company details', async () => {
  const h = harness()
  const id = await issuedAvi(h)
  h.sqlite.exec(`UPDATE invoice SET seller = NULL WHERE id = '${id}'`)
  changeDetails(h)
  expect((await h.run(getInvoice(id))).seller).toMatchObject({
    bankgiro: '5050-1055',
    streetAddress: 'Nya gatan 2',
  })
})
