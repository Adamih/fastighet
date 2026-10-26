import { expect, test } from 'bun:test'
import { billFor } from './billing'

const party = (
  name: string,
  fromDate: string,
  toDate: string | null,
  receivesInvoices = false,
) => ({
  position: name === 'Anna' ? 1 : 2,
  receivesInvoices,
  fromDate,
  toDate,
  party: { id: name, name, streetAddress: null, postalCode: null, city: null, email: null },
})
const rent = {
  id: 'rent',
  kind: 'rent' as const,
  unitId: null,
  description: null,
  amountOre: 900_000,
  interval: 'monthly' as const,
  vat: false,
  fromDate: '2024-01-01',
  toDate: null,
}
const agreement = {
  startDate: '2024-01-01',
  endDate: null,
  charges: [rent],
  parties: [party('Anna', '2024-01-01', null, true), party('Erik', '2026-12-01', null)],
  units: [
    { fromDate: '2024-01-01', toDate: null, designation: 'Uppsala 1:1', label: '1001' },
    { fromDate: '2024-01-01', toDate: '2026-11-30', designation: 'Uppsala 1:1', label: 'P1' },
  ],
}

test('the avi names the parties in force on the period’s first day', () => {
  expect(
    billFor(agreement, { start: '2026-11-01', end: '2026-11-30' }, new Set())?.recipient
      .recipientName,
  ).toBe('Anna')
  expect(
    billFor(agreement, { start: '2026-12-01', end: '2026-12-31' }, new Set())?.recipient
      .recipientName,
  ).toBe('Anna och Erik')
})

test('the line names the units that apply in the period', () => {
  expect(
    billFor(agreement, { start: '2026-11-01', end: '2026-11-30' }, new Set())?.lines[0].description,
  ).toBe('Hyra Uppsala 1:1 · 1001, Uppsala 1:1 · P1, november 2026')
  expect(
    billFor(agreement, { start: '2026-12-01', end: '2026-12-31' }, new Set())?.lines[0].description,
  ).toBe('Hyra Uppsala 1:1 · 1001, december 2026')
})

test('nothing to bill gives no avi', () => {
  expect(
    billFor({ ...agreement, charges: [] }, { start: '2026-11-01', end: '2026-11-30' }, new Set()),
  ).toBeNull()
  expect(
    billFor(
      { ...agreement, endDate: '2026-10-31' },
      { start: '2026-11-01', end: '2026-11-30' },
      new Set(),
    ),
  ).toBeNull()
})
