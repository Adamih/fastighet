import { expect, test } from 'bun:test'
import { propertySummary } from './summary'

const occupancy = (
  leaseId: string,
  status: 'active' | 'upcoming' | 'terminated',
  rentOre: number,
) => ({
  leaseId,
  status,
  rentOre,
  rentInterval: 'monthly' as const,
  vat: false,
})

test('counts rented units and each lease once', () => {
  expect(
    propertySummary([
      { areaSqm: 72.5, occupancy: occupancy('a', 'active', 845_000) },
      { areaSqm: 120, occupancy: occupancy('b', 'terminated', 1_500_000) },
      { areaSqm: null, occupancy: occupancy('b', 'terminated', 1_500_000) },
      { areaSqm: 58, occupancy: occupancy('c', 'upcoming', 690_000) },
      { areaSqm: null, occupancy: null },
    ]),
  ).toEqual({ units: 5, rented: 3, monthlyRentOre: 2_345_000, vat: false, areaSqm: 250.5 })
})

test('yearly rent counts per month', () => {
  expect(
    propertySummary([
      {
        areaSqm: null,
        occupancy: { ...occupancy('a', 'active', 18_000_000), rentInterval: 'yearly', vat: true },
      },
    ]),
  ).toMatchObject({ monthlyRentOre: 1_500_000, vat: true })
})
