import { expect, test } from 'bun:test'
import { listInvoices } from '#/features/invoicing/program'
import { createInvoiceRun } from '#/features/invoicing/run-program'
import { emailInvoice } from '#/features/invoicing/send-program'
import { createLease } from '#/features/leases/program'
import { stockholmDate } from '#/lib/dates'
import { harness } from '#/test/harness'

const month = stockholmDate(Date.now()).slice(0, 7)

async function setup() {
  const h = harness()
  h.sqlite.exec("UPDATE party SET email = 'anna@example.test' WHERE id = 'anna'")
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
  await h.run(createInvoiceRun({ month, send: false }))
  const [avi] = await h.run(listInvoices({ filter: 'all' }))
  return { ...h, avi }
}

test('the avi email links to the avi in Mina sidor when the recipient has access there', async () => {
  const h = await setup()
  h.sqlite.exec(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('t', 'T', 't@x.test', 1, 0, 0);
    INSERT INTO party_access (id, organization_id, party_id, user_id) VALUES ('a', 'org', 'anna', 't');
  `)
  await h.run(emailInvoice(h.avi.id))
  expect(h.outbox.at(-1)?.text).toContain(
    `https://app.example.test/portal/avier/${h.avi.id}?company=org`,
  )
})

test('without portal access the email is as before', async () => {
  const h = await setup()
  await h.run(emailInvoice(h.avi.id))
  expect(h.outbox.at(-1)?.text).not.toContain('/portal/')
})
