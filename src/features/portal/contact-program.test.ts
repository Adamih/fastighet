import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { createInvoiceRun } from '#/features/invoicing/run-program'
import { createLease } from '#/features/leases/program'
import { stockholmDate } from '#/lib/dates'
import { PortalUser } from '#/server/services'
import { fail, harness } from '#/test/harness'
import { asPortal } from '#/test/portal'
import { portalContact, updatePortalContact } from './contact-program'

const as =
  (partyIds: string[]) =>
  <A, E, R>(program: Effect.Effect<A, E, R>) =>
    asPortal(partyIds)(
      program.pipe(
        Effect.provideService(PortalUser, { id: 't', email: 'login@example.test', name: 'T' }),
      ),
    )

const change = {
  partyId: 'anna',
  name: 'Anna Ek',
  email: 'ny@example.test',
  phone: '070-123 45 67',
  streetAddress: 'Nya gatan 2',
  postalCode: '753 20',
  city: 'Uppsala',
}

test("a tenant changes their party's contact details; the login email is separate", async () => {
  const h = harness()
  const after = await h.run(as(['anna'])(updatePortalContact(change)))
  expect(after.parties).toMatchObject([
    {
      id: 'anna',
      name: 'Anna Ek',
      email: 'ny@example.test',
      phone: '070-123 45 67',
      postalCode: '75320',
    },
  ])
  expect(after.loginEmail).toBe('login@example.test')
})

test('only their own parties, and only when the company allows it', async () => {
  const h = harness()
  expect(await fail(h.run(as(['erik'])(updatePortalContact(change))))).toContain('egna uppgifter')
  h.sqlite.exec(
    "UPDATE organization_settings SET portal_contact_edits = 0 WHERE organization_id = 'org'",
  )
  expect(await fail(h.run(as(['anna'])(updatePortalContact(change))))).toContain('Kontakta dem')
  expect(h.sqlite.query("SELECT name, email FROM party WHERE id = 'anna'").get()).toEqual({
    name: 'Anna',
    email: null,
  })
})

test("the portal shows the company's contact details, or the ones chosen for it", async () => {
  const h = harness()
  h.sqlite.exec(
    "UPDATE organization_settings SET email = 'info@test.se', phone = '018-1', portal_contact_phone = '018-2' WHERE organization_id = 'org'",
  )
  const contact = (await h.run(as(['anna'])(portalContact))) as {
    company: object
    editsAllowed: boolean
  }
  expect(contact.company).toEqual({ name: 'Test', email: 'info@test.se', phone: '018-2' })
  expect(contact.editsAllowed).toBe(true)
})

test('a renamed party gets the new name on new avier; issued ones keep theirs', async () => {
  const h = harness()
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
  await h.run(createInvoiceRun({ month: stockholmDate(Date.now()).slice(0, 7), send: false }))
  await h.run(as(['anna'])(updatePortalContact(change)))
  expect(h.sqlite.query('SELECT recipient_name FROM invoice').all()).toEqual([
    { recipient_name: 'Anna' },
  ])
})
