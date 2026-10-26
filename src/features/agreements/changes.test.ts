import { expect, test } from 'bun:test'
import { changeDateProblem, planChange } from './changes'

const row = (id: string, key: string, fromDate = '2024-01-01', toDate: string | null = null) => ({
  id,
  key,
  fromDate,
  toDate,
})

test('a co-tenant moving in is added from the date; the rest stay as they are', () => {
  expect(planChange([row('1', 'anna')], ['anna', 'erik'], '2026-12-01')).toEqual({
    keep: ['1'],
    end: [],
    remove: [],
    add: ['erik'],
  })
})

test('someone moving out ends the day before; ended rows are history and stay', () => {
  const rows = [row('1', 'anna'), row('2', 'erik'), row('0', 'old', '2020-01-01', '2023-12-31')]
  expect(planChange(rows, ['anna'], '2026-12-01')).toEqual({
    keep: ['1'],
    end: [{ id: '2', toDate: '2026-11-30' }],
    remove: [],
    add: [],
  })
})

test('a row that would only have started on or after the date is removed instead', () => {
  expect(
    planChange([row('1', 'anna'), row('2', 'erik', '2026-12-01')], ['anna'], '2026-12-01').remove,
  ).toEqual(['2'])
})

test('a change must come after the start, by the last day, and change something', () => {
  const agreement = { startDate: '2024-01-01', endDate: '2026-12-31' }
  const plan = planChange([row('1', 'anna')], ['anna', 'erik'], '2026-06-01')
  expect(changeDateProblem(agreement, '2026-06-01', plan)).toBeNull()
  expect(changeDateProblem(agreement, '2024-01-01', plan)).toBe('too_early')
  expect(changeDateProblem(agreement, '2027-01-01', plan)).toBe('after_end')
  expect(
    changeDateProblem(
      agreement,
      '2026-06-01',
      planChange([row('1', 'anna')], ['anna'], '2026-06-01'),
    ),
  ).toBe('no_change')
})
