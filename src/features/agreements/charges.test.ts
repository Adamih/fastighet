import { describe, expect, test } from 'bun:test'
import {
  type Charge,
  changeProblem,
  currentBaseCharge,
  invoiceLines,
  lineDescription,
  recurringAmount,
  retroactiveDifference,
  totalsOf,
} from './charges'
import { currentTerms, viewDate } from './current'
import { inForce, overlapsPeriod } from './periods'

const charge = (overrides: Partial<Charge> = {}): Charge => ({
  id: 'rent',
  kind: 'rent',
  unitId: null,
  description: null,
  amountOre: 900_000,
  interval: 'monthly',
  vat: false,
  fromDate: '2024-01-01',
  toDate: null,
  ...overrides,
})
const lease = { startDate: '2024-01-01', endDate: null }
const november = { start: '2026-11-01', end: '2026-11-30' }
const units = [{ designation: 'Uppsala 1:1', label: '1001' }]

describe('periods', () => {
  test('a row applies from its first to its last day', () => {
    const row = { fromDate: '2026-01-01', toDate: '2026-06-30' }
    expect(inForce([row], '2026-06-30')).toHaveLength(1)
    expect(inForce([row], '2026-07-01')).toHaveLength(0)
    expect(overlapsPeriod(row, { start: '2026-06-15', end: '2026-07-15' })).toBe(true)
    expect(overlapsPeriod({ fromDate: '2026-12-01', toDate: null }, november)).toBe(false)
  })
})

describe('recurring charges', () => {
  test('a monthly charge bills the month, a part month per day', () => {
    expect(recurringAmount(charge(), lease, november)).toBe(900_000)
    expect(recurringAmount(charge({ fromDate: '2026-11-16' }), lease, november)).toBe(450_000)
    expect(recurringAmount(charge({ toDate: '2026-11-15' }), lease, november)).toBe(450_000)
  })

  test('the agreement’s own dates also limit it', () => {
    expect(recurringAmount(charge(), { ...lease, endDate: '2026-11-15' }, november)).toBe(450_000)
    expect(recurringAmount(charge(), { ...lease, endDate: '2026-10-31' }, november)).toBe(0)
  })

  test('a change mid-month splits the month between the old and new amount', () => {
    const old = charge({ toDate: '2026-11-15' })
    const next = charge({ id: 'next', amountOre: 960_000, fromDate: '2026-11-16' })
    const lines = invoiceLines([old, next], lease, units, november, new Set())
    expect(lines.map((l) => l.netOre)).toEqual([450_000, 480_000])
  })
})

describe('invoice lines', () => {
  test('base charge first, then add-ons, then one-offs, each with its VAT', () => {
    const lines = invoiceLines(
      [
        charge({
          id: 'key',
          kind: 'one_off',
          interval: 'once',
          amountOre: 50_000,
          fromDate: '2026-10-20',
          description: 'Ny nyckel',
        }),
        charge({ id: 'p', kind: 'parking', amountOre: 60_000, vat: true, description: 'P1' }),
        charge(),
      ],
      lease,
      units,
      november,
      new Set(),
    )
    expect(lines.map((l) => [l.chargeId, l.netOre, l.vatOre])).toEqual([
      ['rent', 900_000, 0],
      ['p', 60_000, 15_000],
      ['key', 50_000, 0],
    ])
    expect(lines.map((l) => l.description)).toEqual([
      'Hyra Uppsala 1:1 · 1001, november 2026',
      'Parkering: P1, november 2026',
      'Ny nyckel',
    ])
    expect(totalsOf(lines)).toEqual({ netOre: 1_010_000, vatOre: 15_000, totalOre: 1_025_000 })
  })

  test('a one-off charge is billed once, on the first avi that covers its date', () => {
    const key = charge({
      id: 'key',
      kind: 'one_off',
      interval: 'once',
      amountOre: 50_000,
      fromDate: '2026-12-05',
    })
    expect(invoiceLines([key], lease, units, november, new Set())).toHaveLength(0)
    const december = { start: '2026-12-01', end: '2026-12-31' }
    expect(invoiceLines([key], lease, units, december, new Set())).toHaveLength(1)
    expect(invoiceLines([key], lease, units, december, new Set(['key']))).toHaveLength(0)
  })

  test('a bostadsrätt bills its fee as Avgift', () => {
    expect(lineDescription(charge({ kind: 'fee' }), units, november)).toBe(
      'Avgift Uppsala 1:1 · 1001, november 2026',
    )
  })
})

describe('changes', () => {
  test('the base charge shown is the one in force, else the next, else the last', () => {
    const old = charge({ toDate: '2026-12-31' })
    const next = charge({ id: 'next', fromDate: '2027-01-01' })
    expect(currentBaseCharge([next, old], '2026-11-01')?.id).toBe('rent')
    expect(currentBaseCharge([next, old], '2027-02-01')?.id).toBe('next')
    expect(currentBaseCharge([charge({ fromDate: '2027-01-01' })], '2026-11-01')?.id).toBe('rent')
    expect(currentBaseCharge([], '2026-11-01')).toBeNull()
  })

  test('a change starts after the current charge began and changes the amount', () => {
    const current = charge()
    expect(changeProblem(current, '2027-01-01', 950_000)).toBeNull()
    expect(changeProblem(current, '2024-01-01', 950_000)).toBe('too_early')
    expect(changeProblem(current, '2027-01-01', 900_000)).toBe('same_amount')
    expect(changeProblem(current, '2027-01-01', -1)).toBe('negative')
    expect(changeProblem(charge({ toDate: '2026-06-30' }), '2027-01-01', 950_000)).toBe('ended')
  })

  test('already billed days from the change are made up on the next avi', () => {
    const invoiced = [
      { start: '2026-10-01', end: '2026-10-31' },
      { start: '2026-11-01', end: '2026-11-30' },
    ]
    // +300 kr a month from 1 October, both months already billed at the old amount.
    expect(retroactiveDifference(charge(), 930_000, '2026-10-01', lease, invoiced)).toBe(60_000)
    // From 16 November only half of November is affected.
    expect(retroactiveDifference(charge(), 930_000, '2026-11-16', lease, invoiced)).toBe(15_000)
    // A reduction gives a negative difference.
    expect(retroactiveDifference(charge(), 870_000, '2026-11-01', lease, invoiced)).toBe(-30_000)
  })
})

describe('current terms', () => {
  const agreement = {
    startDate: '2024-01-01',
    endDate: null,
    parties: [
      { fromDate: '2024-01-01', toDate: '2026-06-30', name: 'Anna' },
      { fromDate: '2026-07-01', toDate: null, name: 'Erik' },
    ],
    units: [{ fromDate: '2024-01-01', toDate: null, label: '1001' }],
    charges: [
      charge({ toDate: '2026-12-31' }),
      charge({ id: 'next', amountOre: 950_000, fromDate: '2027-01-01' }),
    ],
  }

  test('shows what is in force today', () => {
    const now = currentTerms(agreement, '2026-11-01')
    expect(now.parties.map((p) => p.name)).toEqual(['Erik'])
    expect(now.rentOre).toBe(900_000)
    expect(currentTerms(agreement, '2027-02-01').rentOre).toBe(950_000)
  })

  test('upcoming and ended agreements show their first and last day', () => {
    expect(viewDate({ startDate: '2027-01-01', endDate: null }, '2026-11-01')).toBe('2027-01-01')
    expect(viewDate({ startDate: '2020-01-01', endDate: '2025-12-31' }, '2026-11-01')).toBe(
      '2025-12-31',
    )
  })
})

test('an add-on for a unit bills that unit on its own line, not in the rent', () => {
  const both = [
    { unitId: 'flat', designation: 'Uppsala 1:1', label: '1001' },
    { unitId: 'p4', designation: 'Uppsala 1:1', label: 'P4' },
  ]
  const parking = charge({ id: 'p', kind: 'parking', unitId: 'p4', amountOre: 65_000 })
  const lines = invoiceLines([charge(), parking], lease, both, november, new Set())
  expect(lines.map((l) => l.description)).toEqual([
    'Hyra Uppsala 1:1 · 1001, november 2026',
    'Parkering P4, november 2026',
  ])
})
