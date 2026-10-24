import { expect, test } from 'bun:test'
import { invoiceEvents } from './detail'

const today = '2026-10-24'
const base = {
  status: 'unpaid' as const,
  createdOn: '2026-09-10',
  sentOn: null,
  dueDate: '2026-09-30',
  paidOn: null,
  voidedOn: null,
}
const kinds = (input: Parameters<typeof invoiceEvents>[0]) =>
  invoiceEvents(input, today).map((e) => [e.kind, e.date])

test('an overdue invoice lists sending and the due date', () => {
  expect(kinds({ ...base, status: 'overdue', sentOn: '2026-09-10' })).toEqual([
    ['fellDue', '2026-09-30'],
    ['sent', '2026-09-10'],
    ['created', '2026-09-10'],
  ])
})

test('paid on time never fell due', () => {
  expect(kinds({ ...base, status: 'paid', paidOn: '2026-09-28' })).toEqual([
    ['paid', '2026-09-28'],
    ['created', '2026-09-10'],
  ])
})

test('paid late fell due first', () => {
  expect(kinds({ ...base, status: 'paid', paidOn: '2026-10-05' }).map(([k]) => k)).toEqual([
    'paid',
    'fellDue',
    'created',
  ])
})

test('a voided invoice does not fall due', () => {
  expect(kinds({ ...base, status: 'void', voidedOn: '2026-09-20' }).map(([k]) => k)).toEqual([
    'voided',
    'created',
  ])
})

test('a due date still ahead is not an event', () => {
  expect(kinds({ ...base, dueDate: '2026-10-31' }).map(([k]) => k)).toEqual(['created'])
})
