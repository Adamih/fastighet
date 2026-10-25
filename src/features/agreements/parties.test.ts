import { expect, test } from 'bun:test'
import {
  equalShares,
  invoiceRecipient,
  joinNames,
  leaseParties,
  ownershipParties,
  primaryParty,
} from './parties'

const party = (position: number, name: string, receivesInvoices = false) => ({
  position,
  receivesInvoices,
  party: {
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
  expect(recipient.partyId).toBe('Erik')
  expect(recipient.recipientStreetAddress).toBe('Erikgatan 1')
  expect(recipient.recipientEmail).toBe('erik@example.test')
})

test('without a marked receiver the first party receives the avi', () => {
  expect(invoiceRecipient([party(2, 'Erik'), party(1, 'Anna')]).partyId).toBe('Anna')
  expect(primaryParty([party(2, 'Erik'), party(1, 'Anna')]).party.name).toBe('Anna')
})

test('a lease lists the tenant first and one receiver', () => {
  const result = leaseParties('anna', ['erik'], 'erik')
  expect(result).toEqual({
    ok: true,
    parties: [
      { partyId: 'anna', role: 'tenant', receivesInvoices: false, position: 1 },
      { partyId: 'erik', role: 'co_tenant', receivesInvoices: true, position: 2 },
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

test('owners of a bostadsrätt share exactly 100 %', () => {
  const two = ownershipParties(
    [
      { partyId: 'anna', sharePercent: 50 },
      { partyId: 'erik', sharePercent: 50 },
    ],
    'erik',
  )
  expect(two.ok && two.parties.map((p) => [p.partyId, p.sharePercent, p.receivesInvoices])).toEqual(
    [
      ['anna', 50, false],
      ['erik', 50, true],
    ],
  )
  expect(ownershipParties([], null)).toEqual({ ok: false, problem: 'none' })
  expect(ownershipParties([{ partyId: 'anna', sharePercent: 90 }], null)).toEqual({
    ok: false,
    problem: 'shares',
  })
  expect(
    ownershipParties(
      [
        { partyId: 'anna', sharePercent: 50 },
        { partyId: 'anna', sharePercent: 50 },
      ],
      null,
    ),
  ).toEqual({ ok: false, problem: 'duplicate' })
  expect(ownershipParties([{ partyId: 'anna', sharePercent: 100 }], 'erik')).toEqual({
    ok: false,
    problem: 'receiver',
  })
})

test('equal shares add up to 100', () => {
  expect(equalShares(1)).toEqual([100])
  expect(equalShares(2)).toEqual([50, 50])
  expect(equalShares(3)).toEqual([34, 33, 33])
  expect(equalShares(0)).toEqual([])
})
