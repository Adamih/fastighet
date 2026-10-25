import { expect, test } from 'bun:test'
import { invoiceRecipient, joinNames, leaseParties, primaryParty } from './parties'

const party = (position: number, name: string, receivesInvoices = false) => ({
  position,
  receivesInvoices,
  tenant: {
    id: name,
    name,
    streetAddress: `${name}gatan 1`,
    postalCode: '75320',
    city: 'Uppsala',
    email: `${name.toLowerCase()}@example.test`,
  },
})

test('names are joined the Swedish way', () => {
  expect(joinNames([])).toBe('')
  expect(joinNames(['Anna'])).toBe('Anna')
  expect(joinNames(['Anna', 'Erik'])).toBe('Anna och Erik')
  expect(joinNames(['Anna', 'Erik', 'Maja'])).toBe('Anna, Erik och Maja')
})

test('the avi names everyone and goes to the receiving party', () => {
  const recipient = invoiceRecipient([party(2, 'Erik', true), party(1, 'Anna')])
  expect(recipient.recipientName).toBe('Anna och Erik')
  expect(recipient.tenantId).toBe('Erik')
  expect(recipient.recipientStreetAddress).toBe('Erikgatan 1')
  expect(recipient.recipientEmail).toBe('erik@example.test')
})

test('without a marked receiver the first party receives the avi', () => {
  expect(invoiceRecipient([party(2, 'Erik'), party(1, 'Anna')]).tenantId).toBe('Anna')
  expect(primaryParty([party(2, 'Erik'), party(1, 'Anna')]).tenant.name).toBe('Anna')
})

test('a lease lists the tenant first and one receiver', () => {
  const result = leaseParties('anna', ['erik'], 'erik')
  expect(result).toEqual({
    ok: true,
    parties: [
      { tenantId: 'anna', role: 'tenant', receivesInvoices: false, position: 1 },
      { tenantId: 'erik', role: 'co_tenant', receivesInvoices: true, position: 2 },
    ],
  })
  const alone = leaseParties('anna', [], null)
  expect(alone.ok && alone.parties.map((p) => p.receivesInvoices)).toEqual([true])
})

test('lease parties are unique, few, and the receiver is one of them', () => {
  expect(leaseParties('anna', ['anna'], null)).toEqual({ ok: false, problem: 'duplicate' })
  expect(leaseParties('anna', ['erik', 'erik'], null)).toEqual({ ok: false, problem: 'duplicate' })
  expect(leaseParties('anna', ['erik'], 'maja')).toEqual({ ok: false, problem: 'receiver' })
  expect(leaseParties('a', ['b', 'c', 'd', 'e', 'f', 'g'], null)).toEqual({
    ok: false,
    problem: 'too_many',
  })
})
