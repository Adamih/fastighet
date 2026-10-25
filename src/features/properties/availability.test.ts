import { expect, test } from 'bun:test'
import { unitAvailability } from './availability'

const today = '2026-10-24'
const lease = (startDate: string, extra: { termEndDate?: string; moveOutDate?: string } = {}) => ({
  startDate,
  termEndDate: extra.termEndDate ?? null,
  extensionMonths: null,
  noticePeriodMonths: 3,
  moveOutDate: extra.moveOutDate ?? null,
})

test('no leases: vacant from today', () => {
  expect(unitAvailability([], today)).toMatchObject({ state: 'vacant', freeFrom: today })
})

test('ended leases leave the unit vacant', () => {
  expect(unitAvailability([lease('2020-01-01', { moveOutDate: '2024-03-31' })], today).state).toBe(
    'vacant',
  )
})

test('only a coming lease: reserved, free until then', () => {
  const next = lease('2026-11-01')
  expect(unitAvailability([next], today)).toEqual({
    state: 'reserved',
    current: null,
    next,
    freeFrom: today,
  })
})

test('an open-ended lease: rented with no free date', () => {
  expect(unitAvailability([lease('2025-08-01')], today)).toMatchObject({
    state: 'rented',
    freeFrom: null,
  })
})

test('a terminated lease: free the day after moving out', () => {
  expect(
    unitAvailability([lease('2024-04-01', { moveOutDate: '2026-12-31' })], today),
  ).toMatchObject({ state: 'leaving', freeFrom: '2027-01-01' })
})

test('a new lease that follows on: never free', () => {
  const leases = [lease('2024-04-01', { moveOutDate: '2026-12-31' }), lease('2027-01-01')]
  expect(unitAvailability(leases, today)).toMatchObject({ state: 'leaving', freeFrom: null })
})
