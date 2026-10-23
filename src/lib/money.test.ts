/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { formatSek, formatSekShort, oreToInput, parseSek } from './money'

test('formatSekShort drops zero öre only', () => {
  expect(formatSekShort(690000).replace(/\s/g, ' ')).toBe('6 900 kr')
  expect(formatSekShort(833333).replace(/\s/g, ' ')).toBe('8 333,33 kr')
})

describe('parseSek', () => {
  test.each([
    ['8450', 845000],
    ['8 450', 845000],
    ['8 450', 845000],
    ['8450,5', 845050],
    ['8450,50', 845050],
    ['12 000.05', 1200005],
    ['0', 0],
  ] as const)('%p → %p öre', (input, expected) => expect(parseSek(input)).toBe(expected))

  test.each(['', '-100', '8450,505', 'abc', '8,450,00', '1e5'])('rejects %p', (input) =>
    expect(parseSek(input)).toBeNull())
})

test('formatSek', () => {
  expect(formatSek(845050).replace(/\s/g, ' ')).toBe('8 450,50 kr')
})

test('oreToInput round-trips through parseSek', () => {
  for (const ore of [0, 5, 845000, 845050, 1200005]) {
    expect(parseSek(oreToInput(ore))).toBe(ore)
  }
})
