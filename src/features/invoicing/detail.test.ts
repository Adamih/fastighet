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

test('credit notes are events with their number and amount', () => {
  const events = invoiceEvents(
    {
      ...base,
      status: 'credited',
      creditNotes: [
        { number: 2, issueDate: '2026-10-01', totalOre: 200_000 },
        { number: 3, issueDate: '2026-10-20', totalOre: 645_000 },
      ],
    },
    today,
  )
  expect(events.filter((e) => e.kind === 'credited')).toEqual([
    { kind: 'credited', date: '2026-10-20', creditNote: { number: 3, totalOre: 645_000 } },
    { kind: 'credited', date: '2026-10-01', creditNote: { number: 2, totalOre: 200_000 } },
  ])
})

test('an invoice credited in full before its due date never fell due', () => {
  const credited = (issueDate: string) =>
    invoiceEvents(
      { ...base, status: 'credited', creditNotes: [{ number: 1, issueDate, totalOre: 845_000 }] },
      today,
    ).map((e) => e.kind)
  expect(credited('2026-09-20')).not.toContain('fellDue')
  expect(credited('2026-10-10')).toContain('fellDue')
})

test('refunds and corrected avier follow the credit note', () => {
  expect(
    kinds({
      ...base,
      status: 'paid',
      paidOn: '2026-09-28',
      creditNotes: [{ number: 4, issueDate: '2026-10-05', totalOre: 845000 }],
      refunds: [{ date: '2026-10-12', amountOre: 845000 }],
      replacedBy: [{ number: 1050, issueDate: '2026-10-05' }],
    }),
  ).toEqual([
    ['refunded', '2026-10-12'],
    ['replaced', '2026-10-05'],
    ['credited', '2026-10-05'],
    ['paid', '2026-09-28'],
    ['created', '2026-09-10'],
  ])
})
