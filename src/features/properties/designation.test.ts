/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { isValidDesignation, normalizeDesignation } from './designation'

describe('isValidDesignation', () => {
  test.each([
    'Uppsala Kungsängen 12:3',
    'Stockholm Gamla stan 2:1',
    'Malmö Västra Hamnen-Varvet 1:12',
    'Lund Ekeby s:2',
    'Ronneby Kalleberga 4',
    '  Uppsala   Kungsängen 12:3 ',
  ])('accepts %p', (input) => {
    expect(isValidDesignation(input)).toBe(true)
  })

  test.each([
    '',
    '12:3',
    'Kungsängen',
    'Uppsala Kungsängen 12:',
    'Uppsala Kungsängen :3',
  ])('rejects %p', (input) => {
    expect(isValidDesignation(input)).toBe(false)
  })
})

test('normalizeDesignation collapses whitespace', () => {
  expect(normalizeDesignation('  Uppsala   Kungsängen\t12:3 ')).toBe('Uppsala Kungsängen 12:3')
})
