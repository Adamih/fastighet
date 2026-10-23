import { describe, expect, test } from 'bun:test'
import { leaseLine, matchesTenant, tenantCountLine } from './overview'

test('tenantCountLine', () => {
  expect(
    tenantCountLine([
      { kind: 'person' },
      { kind: 'person' },
      { kind: 'person' },
      { kind: 'company' },
    ]),
  ).toBe('3 privatpersoner · 1 företag')
  expect(tenantCountLine([{ kind: 'person' }])).toBe('1 privatperson')
  expect(tenantCountLine([])).toBe('')
})

describe('leaseLine', () => {
  const apartment = { kind: 'apartment' as const, label: '1001' }

  test('lists current leases with their units in order', () => {
    expect(
      leaseLine([
        {
          number: 2,
          status: 'active',
          units: [
            { kind: 'parking', label: 'P1' },
            { kind: 'commercial', label: '2001' },
          ],
        },
      ]),
    ).toBe('#2 · Lokal 2001, P-plats P1')
  })

  test('hides ended leases next to current ones', () => {
    expect(
      leaseLine([
        { number: 5, status: 'upcoming', units: [apartment] },
        { number: 1, status: 'ended', units: [apartment] },
      ]),
    ).toBe('#5 · Lgh 1001')
  })

  test('falls back to the newest ended lease, or nothing', () => {
    expect(leaseLine([{ number: 1, status: 'ended', units: [apartment] }])).toBe('#1 · Lgh 1001')
    expect(leaseLine([])).toBeNull()
  })
})

describe('matchesTenant', () => {
  const cafe = {
    name: 'Kaffe & Kaka AB',
    email: 'ekonomi@kaffeochkaka.test',
    organizationNumber: '559900-0014',
  }

  test('matches name, email and organisationsnummer with or without hyphen', () => {
    expect(matchesTenant(cafe, 'kaka')).toBe(true)
    expect(matchesTenant(cafe, 'ekonomi@')).toBe(true)
    expect(matchesTenant(cafe, '5599000014')).toBe(true)
    expect(matchesTenant(cafe, '559900-00')).toBe(true)
    expect(matchesTenant(cafe, '  ')).toBe(true)
  })

  test('does not match unrelated text', () => {
    expect(matchesTenant(cafe, 'svensson')).toBe(false)
    expect(matchesTenant({ ...cafe, email: null, organizationNumber: null }, '1234')).toBe(false)
  })
})
