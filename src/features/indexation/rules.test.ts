import { expect, test } from 'bun:test'
import {
  adjustmentDate,
  clauseProblem,
  defaultBaseMonth,
  indexSupplement,
  kpiMonthFor,
  perYear,
} from './rules'

test('an index clause needs premises let for a fixed term of at least three years', () => {
  const premises = { unitKinds: ['commercial' as const], startDate: '2024-04-01' }
  expect(clauseProblem({ ...premises, termEndDate: '2027-03-31' })).toBeNull()
  expect(clauseProblem({ ...premises, termEndDate: '2027-03-30' })).toBe('too_short')
  expect(clauseProblem({ ...premises, termEndDate: null })).toBe('not_fixed_term')
  expect(
    clauseProblem({
      unitKinds: ['apartment', 'parking'],
      startDate: '2024-04-01',
      termEndDate: '2030-03-31',
    }),
  ).toBe('residential')
})

test('the clause starts from October before the lease and adjusts from October KPI', () => {
  expect(defaultBaseMonth('2024-04-01')).toBe('2023-10')
  expect(adjustmentDate(2027, 1)).toBe('2027-01-01')
  expect(kpiMonthFor('2027-01-01')).toBe('2026-10')
  expect(kpiMonthFor('2027-04-01')).toBe('2027-01')
  expect(perYear(10_000_00, 'monthly')).toBe(120_000_00)
  expect(perYear(120_000_00, 'yearly')).toBe(120_000_00)
})

test('the supplement follows the indexed share of the base rent, in whole kronor', () => {
  // 240 000 kr a year, base October 2023 (409,07), adjusted from October 2025 (419,35).
  const base = { baseRentPerYearOre: 240_000_00, baseKpi: 40907, kpi: 41935, floorAtBase: true }
  // 240 000 × 10,28 / 409,07 = 6 031,24 → 6 031 kr.
  expect(indexSupplement({ ...base, sharePercent: 100 })).toBe(6_031_00)
  expect(indexSupplement({ ...base, sharePercent: 50 })).toBe(3_016_00)
})

test('the rent never goes below the base rent unless the clause allows it', () => {
  const falling = { baseRentPerYearOre: 120_000_00, sharePercent: 100, baseKpi: 42000, kpi: 41580 }
  expect(indexSupplement({ ...falling, floorAtBase: true })).toBe(0)
  expect(indexSupplement({ ...falling, floorAtBase: false })).toBe(-1_200_00)
})
