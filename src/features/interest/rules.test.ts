import { expect, test } from 'bun:test'
import type { ReceivableEntry } from '#/features/ledger/postings'
import { LATE_INTEREST_MARGIN_BASIS_POINTS, lateInterest, lateInterestRateOn } from './rules'

const rates = [
  { fromDate: '2025-07-01', basisPoints: 200 },
  { fromDate: '2026-01-01', basisPoints: 200 },
  { fromDate: '2026-07-01', basisPoints: 300 },
]
// A 10 000 kr avi due 30 September 2026.
const avi: ReceivableEntry = { kind: 'invoice', date: '2026-09-15', amountOre: 1_000_000 }
const paid = (date: string, amountOre: number): ReceivableEntry => ({
  kind: 'allocation',
  date,
  amountOre: -amountOre,
})

test('the rate is the reference rate in force that day plus eight percentage points', () => {
  expect(LATE_INTEREST_MARGIN_BASIS_POINTS).toBe(800)
  expect(lateInterestRateOn(rates, '2026-06-30')).toBe(1_000)
  expect(lateInterestRateOn(rates, '2026-07-01')).toBe(1_100)
  expect(lateInterestRateOn(rates, '2025-06-30')).toBeNull()
})

test('interest runs from the day after the due date through the day it is paid', () => {
  // 10 000 kr × 11 % × 10 / 365 = 30,14 kr → 30 kr.
  expect(lateInterest([avi, paid('2026-10-10', 1_000_000)], '2026-09-30', rates)).toEqual({
    ore: 3_000,
    fromDate: '2026-10-01',
    toDate: '2026-10-10',
    days: 10,
  })
})

test('nothing on an avi paid by its due date, or not yet settled', () => {
  expect(lateInterest([avi, paid('2026-09-30', 1_000_000)], '2026-09-30', rates)).toBeNull()
  expect(lateInterest([avi, paid('2026-10-10', 900_000)], '2026-09-30', rates)).toBeNull()
})

test('part payments lower what accrues from the day after they arrive', () => {
  // 10 000 kr for 5 days, then 4 000 kr for 5 days: (50 000 + 20 000) × 11 % / 365 = 21,09 kr.
  const result = lateInterest(
    [avi, paid('2026-10-05', 600_000), paid('2026-10-10', 400_000)],
    '2026-09-30',
    rates,
  )
  expect(result).toMatchObject({ ore: 2_100, days: 10, toDate: '2026-10-10' })
})

test('the reminder fee is a claim of its own: it earns no interest and needn’t be paid', () => {
  const fee: ReceivableEntry = { kind: 'reminder', date: '2026-10-05', amountOre: 6_000 }
  expect(lateInterest([avi, fee, paid('2026-10-10', 1_000_000)], '2026-09-30', rates)).toEqual(
    lateInterest([avi, paid('2026-10-10', 1_000_000)], '2026-09-30', rates),
  )
})

test('a debt across 1 July uses each half-year’s rate', () => {
  const june: ReceivableEntry = { kind: 'invoice', date: '2026-05-15', amountOre: 1_000_000 }
  // 30 days at 10 % (1–30 June) and 10 days at 11 % (1–10 July): 82,19 + 30,14 = 112,33 kr.
  expect(lateInterest([june, paid('2026-07-10', 1_000_000)], '2026-05-31', rates)).toMatchObject({
    ore: 11_200,
    days: 40,
  })
})

test('a half-year without a known reference rate is reported, not guessed', () => {
  expect(lateInterest([avi, paid('2027-01-05', 1_000_000)], '2026-12-20', rates)).toEqual({
    missingRateFor: '2027-1',
  })
})
