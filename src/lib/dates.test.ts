/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { addMonths, endOfMonth, isIsoDate, stockholmDate } from './dates'

describe('isIsoDate', () => {
  test.each(['2026-10-23', '2028-02-29'])('accepts %p', (d) => expect(isIsoDate(d)).toBe(true))
  test.each([
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '26-10-23',
    '2026-10-23T00:00',
    '',
  ])('rejects %p', (d) => expect(isIsoDate(d)).toBe(false))
})

describe('addMonths', () => {
  test.each([
    ['2026-01-15', 3, '2026-04-15'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-11-30', 3, '2027-02-28'],
    ['2027-12-31', -9, '2027-03-31'],
    ['2027-12-31', 36, '2030-12-31'],
  ] as const)('%p + %p months = %p', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected)
  })
})

test('endOfMonth', () => {
  expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
  expect(endOfMonth('2028-02-01')).toBe('2028-02-29')
  expect(endOfMonth('2026-12-31')).toBe('2026-12-31')
})

test('stockholmDate uses Swedish time, not UTC', () => {
  // Winter (UTC+1): 22:30 UTC is 23:30 the same day, 23:30 UTC is already the next day.
  expect(stockholmDate(Date.UTC(2026, 11, 31, 22, 30))).toBe('2026-12-31')
  expect(stockholmDate(Date.UTC(2026, 11, 31, 23, 30))).toBe('2027-01-01')
  // Summer (UTC+2): 22:30 UTC on 30 Jun is 00:30 on 1 Jul.
  expect(stockholmDate(Date.UTC(2026, 5, 30, 22, 30))).toBe('2026-07-01')
})
