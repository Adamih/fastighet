/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { formatOrganizationNumber, isValidOrganizationNumber } from './organization-number'

describe('isValidOrganizationNumber', () => {
  // 202100-5489 is Skatteverket's published organisationsnummer.
  test.each([
    '202100-5489',
    '2021005489',
    '16202100-5489',
    ' 202100 5489 ',
  ])('accepts %p', (input) => expect(isValidOrganizationNumber(input)).toBe(true))

  test.each([
    '202100-5488',
    '20210054',
    '202100-54890',
    '17202100-5489',
    'abcdef-ghij',
    '',
  ])('rejects %p', (input) => expect(isValidOrganizationNumber(input)).toBe(false))
})

test('formatOrganizationNumber normalizes to NNNNNN-NNNN', () => {
  expect(formatOrganizationNumber('2021005489')).toBe('202100-5489')
  expect(formatOrganizationNumber('16202100-5489')).toBe('202100-5489')
})
