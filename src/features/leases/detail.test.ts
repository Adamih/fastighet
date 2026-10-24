import { describe, expect, test } from 'bun:test'
import { leaseEvents, nextInvoicePeriod, shortPeriodLabel } from './detail'

const today = '2026-10-24'
const lease = {
  startDate: '2025-08-01',
  endDate: null,
  extensionMonths: null,
  noticePeriodMonths: 3,
  moveOutDate: null,
  invoiceInterval: 'monthly' as const,
}
const invoice = (
  number: number,
  periodStart: string,
  periodEnd: string,
  extra: Partial<{
    status: 'void' | 'paid' | 'overdue' | 'unpaid'
    sentOn: string
    paidOn: string
  }> = {},
) => ({
  number,
  periodStart,
  periodEnd,
  status: extra.status ?? ('unpaid' as const),
  sentOn: extra.sentOn ?? null,
  paidOn: extra.paidOn ?? null,
})

describe('nextInvoicePeriod', () => {
  test('without invoices, the current period', () => {
    expect(nextInvoicePeriod(lease, [], today)).toEqual({ start: '2026-10-01', end: '2026-10-31' })
  })

  test('without invoices, the month a future lease starts in', () => {
    expect(nextInvoicePeriod({ ...lease, startDate: '2026-11-01' }, [], today)).toEqual({
      start: '2026-11-01',
      end: '2026-11-30',
    })
  })

  test('without invoices, a quarterly lease is in the quarter that already started', () => {
    expect(
      nextInvoicePeriod(
        { ...lease, startDate: '2024-01-01', invoiceInterval: 'quarterly' },
        [],
        '2026-11-15',
      ),
    ).toEqual({ start: '2026-10-01', end: '2026-12-31' })
  })

  test('follows the latest invoice, ignoring voided ones', () => {
    const invoices = [
      invoice(1, '2026-09-01', '2026-09-30'),
      invoice(2, '2026-10-01', '2026-10-31', { status: 'void' }),
    ]
    expect(nextInvoicePeriod(lease, invoices, today)).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    })
  })

  test('quarterly leases wait for the next quarter', () => {
    expect(
      nextInvoicePeriod(
        { ...lease, startDate: '2026-11-15', invoiceInterval: 'quarterly' },
        [],
        today,
      ),
    ).toEqual({ start: '2027-01-01', end: '2027-03-31' })
  })

  test('nothing after the last day of a terminated lease', () => {
    const terminated = { ...lease, moveOutDate: '2026-10-31' }
    expect(
      nextInvoicePeriod(terminated, [invoice(1, '2026-10-01', '2026-10-31')], today),
    ).toBeNull()
  })

  test('a fixed term that renews keeps going past its end date', () => {
    const renewing = { ...lease, endDate: '2026-10-31', extensionMonths: 12 }
    expect(nextInvoicePeriod(renewing, [invoice(1, '2026-10-01', '2026-10-31')], today)).toEqual({
      start: '2026-11-01',
      end: '2026-11-30',
    })
  })
})

test('leaseEvents lists past events newest first', () => {
  const events = leaseEvents(
    { ...lease, createdOn: '2025-07-20', noticeDate: '2026-09-30', moveOutDate: '2026-12-31' },
    [invoice(1, '2026-10-01', '2026-10-31', { sentOn: '2026-09-10', paidOn: '2026-09-28' })],
    '2026-10-24',
  )
  expect(events.map((e) => [e.kind, e.date])).toEqual([
    ['noticeGiven', '2026-09-30'],
    ['invoicePaid', '2026-09-28'],
    ['invoiceSent', '2026-09-10'],
    ['started', '2025-08-01'],
    ['created', '2025-07-20'],
  ])
})

test('shortPeriodLabel', () => {
  expect(shortPeriodLabel({ start: '2026-11-01', end: '2026-11-30' })).toBe('nov 2026')
  expect(shortPeriodLabel({ start: '2026-10-01', end: '2026-12-31' })).toBe('okt–dec 2026')
})
