/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  earliestMoveOutDate,
  type LeaseTerms,
  leaseStatus,
  occupyingLease,
  periodsOverlap,
} from './terms'

const openEnded: LeaseTerms = {
  startDate: '2026-01-01',
  termEndDate: null,
  extensionMonths: null,
  noticePeriodMonths: 3,
  moveOutDate: null,
}

// Typical commercial lease: three years, nine months' notice, extended three years at a time.
const commercial: LeaseTerms = {
  startDate: '2025-01-01',
  termEndDate: '2027-12-31',
  extensionMonths: 36,
  noticePeriodMonths: 9,
  moveOutDate: null,
}

describe('leaseStatus', () => {
  test('upcoming before the start date', () => {
    expect(leaseStatus(openEnded, '2025-12-31')).toBe('upcoming')
  })
  test('active from the start date', () => {
    expect(leaseStatus(openEnded, '2026-01-01')).toBe('active')
  })
  test('terminated while the notice period runs, ended after the move-out date', () => {
    const terminated = { ...openEnded, moveOutDate: '2026-04-30' }
    expect(leaseStatus(terminated, '2026-04-30')).toBe('terminated')
    expect(leaseStatus(terminated, '2026-05-01')).toBe('ended')
  })
  test('fixed term without extension ends by itself', () => {
    const fixed = { ...openEnded, termEndDate: '2026-06-30' }
    expect(leaseStatus(fixed, '2026-06-30')).toBe('active')
    expect(leaseStatus(fixed, '2026-07-01')).toBe('ended')
  })
  test('fixed term with extension keeps running past its end date', () => {
    expect(leaseStatus(commercial, '2028-06-01')).toBe('active')
  })
})

describe('earliestMoveOutDate', () => {
  test.each([
    ['2026-01-15', '2026-04-30'],
    ['2026-01-31', '2026-04-30'],
    ['2026-02-01', '2026-05-31'],
    ['2026-11-20', '2027-02-28'],
  ] as const)('open-ended, notice on %p → %p', (notice, expected) => {
    expect(earliestMoveOutDate(openEnded, notice)).toBe(expected)
  })

  test('commercial: notice in time ends at the current term end', () => {
    expect(earliestMoveOutDate(commercial, '2027-03-31')).toBe('2027-12-31')
  })
  test('commercial: one day late extends to the next term end', () => {
    expect(earliestMoveOutDate(commercial, '2027-04-01')).toBe('2030-12-31')
  })
  test('commercial: several terms later', () => {
    expect(earliestMoveOutDate(commercial, '2031-06-15')).toBe('2033-12-31')
  })
  test('fixed term without extension never ends before its end date', () => {
    const fixed = { ...openEnded, termEndDate: '2026-12-31' }
    expect(earliestMoveOutDate(fixed, '2026-02-01')).toBe('2026-12-31')
    expect(earliestMoveOutDate(fixed, '2026-11-01')).toBe('2027-02-28')
  })
})

describe('occupyingLease', () => {
  const ended = { ...openEnded, moveOutDate: '2026-03-31' }
  const current = { ...openEnded, startDate: '2026-04-01' }
  const next = { ...openEnded, startDate: '2027-01-01' }

  test('prefers the current lease over a later one', () => {
    expect(occupyingLease([next, ended, current], '2026-06-01')?.lease).toBe(current)
  })
  test('falls back to the next upcoming lease', () => {
    expect(occupyingLease([ended, next], '2026-06-01')).toEqual({ lease: next, status: 'upcoming' })
  })
  test('null when only ended leases remain', () => {
    expect(occupyingLease([ended], '2026-06-01')).toBeNull()
  })
})

describe('periodsOverlap', () => {
  const p = (start: string, end: string | null) => ({ start, end })
  test.each([
    [p('2026-01-01', '2026-03-31'), p('2026-03-31', null), true],
    [p('2026-01-01', '2026-03-31'), p('2026-04-01', null), false],
    [p('2026-01-01', null), p('2030-01-01', '2030-12-31'), true],
    [p('2026-05-01', '2026-05-31'), p('2026-01-01', '2026-04-30'), false],
    [p('2026-01-01', null), p('2025-01-01', null), true],
  ] as const)('%p vs %p → %p', (a, b, expected) => {
    expect(periodsOverlap(a, b)).toBe(expected)
    expect(periodsOverlap(b, a)).toBe(expected)
  })
})
