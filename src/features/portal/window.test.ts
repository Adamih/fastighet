import { expect, test } from 'bun:test'
import { agreementVisible } from './window'

const today = '2026-10-29'

test('a running agreement always shows', () => {
  expect(agreementVisible({ endDate: null, moneyOpen: false, lastMoneyOn: null }, today)).toBe(true)
  expect(
    agreementVisible({ endDate: '2027-03-31', moneyOpen: false, lastMoneyOn: null }, today),
  ).toBe(true)
})

test('an ended agreement shows while money is open, however old', () => {
  expect(
    agreementVisible({ endDate: '2020-01-31', moneyOpen: true, lastMoneyOn: '2020-02-10' }, today),
  ).toBe(true)
})

test('once settled, it shows for twelve months after the later of its end and the last money', () => {
  const settled = { endDate: '2025-09-30', moneyOpen: false }
  expect(agreementVisible({ ...settled, lastMoneyOn: '2025-11-15' }, today)).toBe(true)
  expect(agreementVisible({ ...settled, lastMoneyOn: '2025-10-28' }, today)).toBe(false)
  expect(agreementVisible({ ...settled, lastMoneyOn: '2025-10-29' }, today)).toBe(true)
  expect(agreementVisible({ ...settled, lastMoneyOn: null }, today)).toBe(false)
  expect(
    agreementVisible({ endDate: '2025-10-29', moneyOpen: false, lastMoneyOn: null }, today),
  ).toBe(true)
})
