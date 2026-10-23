/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  dueDate,
  formatBankgiro,
  invoicePeriod,
  invoiceStatus,
  isValidBankgiro,
  ocrFor,
  periodLabel,
  type RentTerms,
  rentForPeriod,
  vatFor,
  vatNumberFor,
} from './rules'

test('invoiceStatus', () => {
  const open = { voidedAt: null, paidOn: null, dueDate: '2026-11-30' }
  expect(invoiceStatus(open, '2026-11-30')).toBe('unpaid')
  expect(invoiceStatus(open, '2026-12-01')).toBe('overdue')
  expect(invoiceStatus({ ...open, paidOn: '2026-12-05' }, '2027-01-01')).toBe('paid')
  expect(invoiceStatus({ ...open, voidedAt: new Date() }, '2027-01-01')).toBe('void')
})

const periodOf = (month: string, interval: 'monthly' | 'quarterly') => {
  const period = invoicePeriod(month, interval)
  if (!period) throw new Error(`${month} is not invoiced ${interval}`)
  return period
}

const monthly: RentTerms = {
  startDate: '2026-01-01',
  endDate: null,
  extensionMonths: null,
  noticePeriodMonths: 3,
  moveOutDate: null,
  rentOre: 845000,
  rentInterval: 'monthly',
  invoiceInterval: 'monthly',
  vat: false,
}

const yearlyQuarterly: RentTerms = {
  ...monthly,
  rentOre: 10000000, // 100 000 kr per year
  rentInterval: 'yearly',
  invoiceInterval: 'quarterly',
  vat: true,
}

describe('invoicePeriod', () => {
  test('monthly invoicing covers the month', () => {
    expect(invoicePeriod('2026-02', 'monthly')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
  test('quarterly invoicing covers the quarter, only from quarter starts', () => {
    expect(invoicePeriod('2026-10', 'quarterly')).toEqual({
      start: '2026-10-01',
      end: '2026-12-31',
    })
    expect(invoicePeriod('2026-11', 'quarterly')).toBeNull()
  })
})

describe('rentForPeriod', () => {
  test('a full month is the monthly rent', () => {
    expect(rentForPeriod(monthly, periodOf('2026-12', 'monthly'))).toBe(845000)
  })

  test('yearly rent split over twelve months adds up exactly', () => {
    const yearlyMonthly = { ...yearlyQuarterly, invoiceInterval: 'monthly' as const }
    const months = Array.from({ length: 12 }, (_, i) =>
      rentForPeriod(yearlyMonthly, periodOf(`2026-${String(i + 1).padStart(2, '0')}`, 'monthly')),
    )
    expect(months.reduce((a, b) => a + b, 0)).toBe(10000000)
    expect(new Set(months)).toEqual(new Set([833333, 833334]))
  })

  test('four quarters of yearly rent add up exactly', () => {
    const quarters = ['2026-01', '2026-04', '2026-07', '2026-10'].map((m) =>
      rentForPeriod(yearlyQuarterly, periodOf(m, 'quarterly')),
    )
    expect(quarters.reduce((a, b) => a + b, 0)).toBe(10000000)
  })

  test('move-in mid-month is charged per day', () => {
    const movesIn = { ...monthly, startDate: '2026-12-16' }
    // 16 of 31 days of 8 450 kr = 4 361,29 kr
    expect(rentForPeriod(movesIn, periodOf('2026-12', 'monthly'))).toBe(436129)
  })

  test('move-out mid-quarter only charges the covered days', () => {
    const movesOut = { ...yearlyQuarterly, moveOutDate: '2026-11-15' }
    const q4 = rentForPeriod(movesOut, periodOf('2026-10', 'quarterly'))
    // October in full (833 333) + 15/30 of November (833 333 → 416 667)
    expect(q4).toBe(833333 + 416667)
  })

  test('no rent outside the lease', () => {
    expect(
      rentForPeriod({ ...monthly, startDate: '2027-01-01' }, periodOf('2026-12', 'monthly')),
    ).toBe(0)
    expect(
      rentForPeriod({ ...monthly, moveOutDate: '2026-11-30' }, periodOf('2026-12', 'monthly')),
    ).toBe(0)
  })

  test('a fixed term without extension ends by itself', () => {
    const fixed = { ...monthly, endDate: '2026-12-10' }
    expect(rentForPeriod(fixed, periodOf('2026-12', 'monthly'))).toBe(
      Math.round((845000 * 10) / 31),
    )
  })
})

test('vatFor', () => {
  expect(vatFor(2500000, true)).toBe(625000)
  expect(vatFor(833333, true)).toBe(208333)
  expect(vatFor(845000, false)).toBe(0)
})

describe('dueDate', () => {
  const december = { start: '2026-12-01', end: '2026-12-31' }
  test('last weekday before the period when issued in good time', () => {
    expect(dueDate(december, '2026-11-02')).toBe('2026-11-30')
  })
  test('never sooner than ten days after issue', () => {
    expect(dueDate(december, '2026-11-25')).toBe('2026-12-05')
  })
})

test('ocrFor appends a Luhn check digit', () => {
  expect(ocrFor(1)).toBe('18')
  expect(ocrFor(123456789)).toBe('1234567897')
})

test('bankgiro', () => {
  expect(isValidBankgiro('5050-1055')).toBe(true)
  expect(isValidBankgiro('50501055')).toBe(true)
  expect(isValidBankgiro('5050-1056')).toBe(false)
  expect(isValidBankgiro('123')).toBe(false)
  expect(formatBankgiro('50501055')).toBe('5050-1055')
  expect(formatBankgiro('9912346')).toBe('991-2346')
})

test('vatNumberFor', () => {
  expect(vatNumberFor('202100-5489')).toBe('SE202100548901')
})

test('periodLabel', () => {
  expect(periodLabel({ start: '2026-12-01', end: '2026-12-31' })).toBe('december 2026')
  expect(periodLabel({ start: '2027-01-01', end: '2027-03-31' })).toBe('januari–mars 2027')
})
