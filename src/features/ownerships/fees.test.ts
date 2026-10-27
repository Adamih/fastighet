import { expect, test } from 'bun:test'
import { feeFor, feePercentProblem, formatFeePercent, parseFeePercent } from './fees'

const amounts = { 2023: 52_500, 2026: 59_200 }

test('a fee is a share of the prisbasbelopp for the year, rounded down to whole kronor', () => {
  expect(feeFor(100, amounts, '2026-03-01')).toEqual({
    ore: 59_200,
    year: 2026,
    priceBaseAmountKr: 59_200,
  })
  expect(feeFor(250, amounts, '2026-12-31')).toMatchObject({ ore: 148_000 })
  // 2.5 % of 52 500 kr is 1 312,50 kr: never above the share.
  expect(feeFor(250, amounts, '2023-06-01')).toMatchObject({ ore: 131_200 })
  expect(feeFor(100, amounts, '2027-01-02')).toEqual({ missing: 2027 })
})

test('shares are typed as percent and capped by law', () => {
  expect(parseFeePercent('2,5')).toBe(250)
  expect(parseFeePercent('2.5 %')).toBe(250)
  expect(parseFeePercent('1')).toBe(100)
  expect(parseFeePercent('0,75')).toBe(75)
  expect(parseFeePercent('1,234')).toBeNull()
  expect(parseFeePercent('abc')).toBeNull()
  expect(formatFeePercent(250)).toBe('2,5')
  expect(formatFeePercent(100)).toBe('1')

  expect(feePercentProblem('pledge_fee', '')).toBeNull()
  expect(feePercentProblem('pledge_fee', '1')).toBeNull()
  expect(feePercentProblem('pledge_fee', '1,5')).toBe('too_high')
  expect(feePercentProblem('transfer_fee', '2,5')).toBeNull()
  expect(feePercentProblem('transfer_fee', '3')).toBe('too_high')
  expect(feePercentProblem('transfer_fee', '0')).toBe('invalid')
  expect(feePercentProblem('transfer_fee', 'x')).toBe('invalid')
})
