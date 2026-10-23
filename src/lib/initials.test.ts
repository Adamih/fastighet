import { expect, test } from 'bun:test'
import { initials } from './initials'

test('initials skip words that do not start with a letter', () => {
  expect(initials('Anna Svensson')).toBe('AS')
  expect(initials('Kaffe & Kaka AB')).toBe('KK')
  expect(initials('Örjan')).toBe('Ö')
  expect(initials('Olle Ägare')).toBe('OÄ')
})
