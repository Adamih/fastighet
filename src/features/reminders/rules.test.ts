import { expect, test } from 'bun:test'
import {
  MAX_REMINDER_FEE_ORE,
  nextReminderOn,
  reminderDueDate,
  reminderFee,
  reminderProblem,
} from './rules'

const overdue = {
  status: 'overdue',
  owedOre: 900_000,
  dueDate: '2026-10-01',
  recipientEmail: 'anna@example.test',
}
const settings = { reminderIntervalDays: 10, reminderFeeOre: 6_000, reminderDueDays: 10 }

test('an overdue avi can be reminded once the interval has passed', () => {
  expect(reminderProblem(overdue, [], settings, '2026-10-11')).toBeNull()
  expect(reminderProblem(overdue, [], settings, '2026-10-10')).toBe('too_soon')
  expect(reminderProblem({ ...overdue, status: 'unpaid' }, [], settings, '2026-10-20')).toBe(
    'not_overdue',
  )
  expect(reminderProblem({ ...overdue, owedOre: 0 }, [], settings, '2026-10-20')).toBe(
    'nothing_owed',
  )
  expect(reminderProblem({ ...overdue, recipientEmail: null }, [], settings, '2026-10-20')).toBe(
    'no_email',
  )
})

test('the next reminder waits the interval after the last one', () => {
  const sent = [{ sentOn: '2026-10-11' }]
  expect(reminderProblem(overdue, sent, settings, '2026-10-20')).toBe('too_soon')
  expect(reminderProblem(overdue, sent, settings, '2026-10-21')).toBeNull()
  expect(nextReminderOn(overdue.dueDate, sent, settings)).toBe('2026-10-21')
  expect(nextReminderOn(overdue.dueDate, [], settings)).toBe('2026-10-11')
})

test('the fee is the agreed amount, at most 60 kr, and only once per avi', () => {
  expect(reminderFee(settings, [])).toBe(6_000)
  expect(reminderFee({ reminderFeeOre: 10_000 }, [])).toBe(MAX_REMINDER_FEE_ORE)
  expect(reminderFee(settings, [{ feeOre: 6_000 }])).toBe(0)
  expect(reminderFee(settings, [{ feeOre: 0 }])).toBe(6_000)
  expect(reminderFee({ reminderFeeOre: null }, [])).toBe(0)
})

test('the reminder is due after its payment term, on a weekday', () => {
  expect(reminderDueDate('2026-10-14', settings)).toBe('2026-10-26') // Saturday 24th → Monday
  expect(reminderDueDate('2026-10-12', settings)).toBe('2026-10-22')
})
