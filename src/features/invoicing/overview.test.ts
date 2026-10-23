import { describe, expect, test } from 'bun:test'
import { daysAgo, dueNote, invoiceCount, invoiceOverview, matchesFilter } from './overview'

const today = '2026-10-23'

describe('matchesFilter', () => {
  test('unpaid includes overdue', () => {
    expect(matchesFilter('overdue', 'unpaid')).toBe(true)
    expect(matchesFilter('unpaid', 'unpaid')).toBe(true)
    expect(matchesFilter('paid', 'unpaid')).toBe(false)
  })

  test('the other filters match their own status', () => {
    expect(matchesFilter('unpaid', 'overdue')).toBe(false)
    expect(matchesFilter('void', 'void')).toBe(true)
    expect(matchesFilter('void', 'all')).toBe(true)
  })
})

describe('dueNote', () => {
  test('counts days since an overdue due date', () => {
    expect(dueNote({ status: 'overdue', totalOre: 1, dueDate: '2026-09-30' }, today)).toBe(
      '23 dagar sen',
    )
    expect(dueNote({ status: 'overdue', totalOre: 1, dueDate: '2026-10-22' }, today)).toBe('i går')
  })

  test('counts days to an upcoming due date', () => {
    expect(dueNote({ status: 'unpaid', totalOre: 1, dueDate: '2026-10-28' }, today)).toBe(
      'om 5 dagar',
    )
    expect(dueNote({ status: 'unpaid', totalOre: 1, dueDate: today }, today)).toBe('i dag')
  })

  test('says nothing for paid or void invoices', () => {
    expect(dueNote({ status: 'paid', totalOre: 1, dueDate: '2026-09-30' }, today)).toBeNull()
    expect(dueNote({ status: 'void', totalOre: 1, dueDate: '2026-09-30' }, today)).toBeNull()
  })
})

test('daysAgo and invoiceCount', () => {
  expect(daysAgo(0)).toBe('i dag')
  expect(daysAgo(2)).toBe('2 dagar sen')
  expect(invoiceCount(1)).toBe('1 avi')
  expect(invoiceCount(0)).toBe('0 avier')
})

test('invoiceOverview sums open, overdue and paid invoices', () => {
  const invoices = [
    { status: 'overdue' as const, totalOre: 845_000, dueDate: '2026-09-30' },
    { status: 'overdue' as const, totalOre: 100_000, dueDate: '2026-10-15' },
    { status: 'unpaid' as const, totalOre: 50_000, dueDate: '2026-10-31' },
    { status: 'paid' as const, totalOre: 720_000, dueDate: '2026-09-30' },
    { status: 'void' as const, totalOre: 999_999, dueDate: '2026-09-30' },
  ]
  expect(invoiceOverview(invoices, today)).toEqual({
    counts: { all: 5, unpaid: 3, overdue: 2, paid: 1, void: 1 },
    outstanding: { count: 3, totalOre: 995_000 },
    overdue: { count: 2, totalOre: 945_000, oldestDays: 23 },
    paid: { count: 1, totalOre: 720_000 },
  })
})

test('invoiceOverview without overdue invoices', () => {
  expect(invoiceOverview([], today).overdue).toEqual({ count: 0, totalOre: 0, oldestDays: null })
})
