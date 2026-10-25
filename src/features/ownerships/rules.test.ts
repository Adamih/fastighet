import { expect, test } from 'bun:test'
import { formatShareRatio, invoicedPastTransfer, sellersLastDay, transferProblem } from './rules'

test('a bostadsrätt is transferred once, after it started', () => {
  const owned = { startDate: '2020-05-01', endDate: null }
  expect(transferProblem(owned, '2026-11-01')).toBeNull()
  expect(transferProblem(owned, '2020-05-01')).toBe('too_early')
  expect(transferProblem({ ...owned, endDate: '2026-10-31' }, '2026-11-01')).toBe('ended')
  expect(sellersLastDay('2026-11-01')).toBe('2026-10-31')
})

test('avier covering the buyers’ days are flagged', () => {
  const avi = (number: number, periodEnd: string, status: 'paid' | 'void' = 'paid') => ({
    number,
    periodEnd,
    status,
  })
  expect(
    invoicedPastTransfer(
      [avi(1, '2026-10-31'), avi(2, '2026-11-30'), avi(3, '2026-11-30', 'void')],
      '2026-11-15',
    ).map((i) => i.number),
  ).toEqual([2])
})

test('andelstal is shown as a Swedish percentage', () => {
  expect(formatShareRatio(2.145)).toBe('2,145 %')
  expect(formatShareRatio(4)).toBe('4 %')
})
