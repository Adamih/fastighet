/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { isLuhnValid, luhnCheckDigit } from './luhn'

test('luhnCheckDigit', () => {
  expect(luhnCheckDigit('123456789')).toBe(7)
  expect(luhnCheckDigit('5050105')).toBe(5) // Skatteverket's bankgiro 5050-1055
  expect(luhnCheckDigit('202100548')).toBe(9) // Skatteverket's organisationsnummer 202100-5489
  expect(luhnCheckDigit('1')).toBe(8)
})

test('isLuhnValid', () => {
  for (const valid of ['1234567897', '50501055', '2021005489', '18', '0']) {
    expect(isLuhnValid(valid)).toBe(true)
  }
  for (const invalid of ['1234567898', '50501056', '', '12a4']) {
    expect(isLuhnValid(invalid)).toBe(false)
  }
})

test('every generated check digit validates', () => {
  for (let n = 1; n < 2000; n += 37) {
    const base = String(n)
    expect(isLuhnValid(base + luhnCheckDigit(base))).toBe(true)
  }
})
