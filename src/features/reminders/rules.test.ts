import { describe, expect, test } from 'bun:test'
import type { ReceivableEntry } from '#/features/ledger/postings'
import {
  automaticFeeWaiver,
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

describe('automatic fee waivers', () => {
  // A 9 000 kr avi due 1 October, reminded on 11 October, due 21 October.
  const reminder = { sentOn: '2026-10-11', dueDate: '2026-10-21' }
  const avi: ReceivableEntry[] = [{ kind: 'invoice', date: '2026-09-15', amountOre: 900_000 }]
  const paid = (date: string, amountOre: number): ReceivableEntry => ({
    kind: 'allocation',
    date,
    amountOre: -amountOre,
  })
  const off = { waiveReminderFeeByDueDate: false }
  const on = { waiveReminderFeeByDueDate: true }

  test('money booked by the day the reminder went out waives the fee', () => {
    expect(automaticFeeWaiver([...avi, paid('2026-10-09', 900_000)], reminder, off)).toBe(
      'paid_before_reminder',
    )
    expect(automaticFeeWaiver([...avi, paid('2026-10-11', 900_000)], reminder, off)).toBe(
      'paid_before_reminder',
    )
    // Two part payments that together had settled it.
    expect(
      automaticFeeWaiver(
        [...avi, paid('2026-10-02', 400_000), paid('2026-10-10', 500_000)],
        reminder,
        off,
      ),
    ).toBe('paid_before_reminder')
    expect(automaticFeeWaiver([...avi, paid('2026-10-12', 900_000)], reminder, off)).toBeNull()
    // Only part had arrived: the reminder was right.
    expect(
      automaticFeeWaiver(
        [...avi, paid('2026-10-10', 500_000), paid('2026-10-12', 400_000)],
        reminder,
        off,
      ),
    ).toBeNull()
  })

  test('paid by the reminder’s due date waives it, if the company chose so', () => {
    const avierOnly = [...avi, paid('2026-10-20', 900_000)]
    expect(automaticFeeWaiver(avierOnly, reminder, on)).toBe('paid_by_due_date')
    expect(automaticFeeWaiver(avierOnly, reminder, off)).toBeNull()
    expect(automaticFeeWaiver([...avi, paid('2026-10-21', 900_000)], reminder, on)).toBe(
      'paid_by_due_date',
    )
    expect(automaticFeeWaiver([...avi, paid('2026-10-22', 900_000)], reminder, on)).toBeNull()
  })

  test('a fee posted to the avi itself, as before fees were charges, isn’t its debt', () => {
    const legacy: ReceivableEntry = { kind: 'reminder', date: '2026-10-11', amountOre: 6_000 }
    expect(automaticFeeWaiver([...avi, legacy, paid('2026-10-09', 900_000)], reminder, off)).toBe(
      'paid_before_reminder',
    )
  })
})
