import { expect, test } from 'bun:test'
import { parseKpi } from './scb'

test('KPI from SCB: published months, as hundredths', () => {
  const body = {
    value: [null, 418.49, 423.06, null],
    dimension: {
      Tid: { category: { index: { '2025M12': 0, '2026M01': 1, '2026M09': 2, '2026M10': 3 } } },
    },
  }
  expect(parseKpi(body)).toEqual([
    { month: '2026-01', valueHundredths: 41849 },
    { month: '2026-09', valueHundredths: 42306 },
  ])
  expect(() => parseKpi({})).toThrow()
})
