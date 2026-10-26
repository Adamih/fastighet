import { expect, test } from 'bun:test'
import { inForce, refundProblem, reissueProblem, voidProblem } from './correction'

const avi = (overrides: Partial<Parameters<typeof inForce>[0]> = {}) => ({
  voidedAt: null,
  totalOre: 845000,
  creditedOre: 0,
  ...overrides,
})

test('voided and fully credited avier no longer count for their period', () => {
  expect(inForce(avi())).toBe(true)
  expect(inForce(avi({ creditedOre: 200000 }))).toBe(true)
  expect(inForce(avi({ creditedOre: 845000 }))).toBe(false)
  expect(inForce(avi({ voidedAt: new Date(0) }))).toBe(false)
})

test('a refund pays back what the avi was overpaid by, up to today', () => {
  const today = '2026-10-24'
  expect(refundProblem({ refundDueOre: 150_000 }, '2026-10-20', today)).toBeNull()
  expect(refundProblem({ refundDueOre: 150_000 }, '2026-10-25', today)).toBe('future')
  expect(refundProblem({ refundDueOre: 0 }, '2026-10-20', today)).toBe('nothing_due')
})

test('a corrected avi replaces a voided or fully credited one, once', () => {
  const voided = avi({ voidedAt: new Date(0) })
  expect(reissueProblem(voided, [], 845000)).toBeNull()
  expect(reissueProblem(avi({ creditedOre: 845000 }), [voided], 845000)).toBeNull()
  expect(reissueProblem(avi(), [], 845000)).toBe('in_force')
  expect(reissueProblem(voided, [avi()], 845000)).toBe('already_replaced')
  expect(reissueProblem(voided, [], 0)).toBe('no_rent')
})

test('only an unsent, unpaid avi without credit notes can be voided', () => {
  const unsent = { voidedAt: null, paidOre: 0, creditedOre: 0, sentAt: null }
  expect(voidProblem(unsent)).toBeNull()
  expect(voidProblem({ ...unsent, sentAt: new Date(0) })).toBe('sent')
  expect(voidProblem({ ...unsent, creditedOre: 100000 })).toBe('credited')
  expect(voidProblem({ ...unsent, paidOre: 100_000 })).toBe('paid')
  expect(voidProblem({ ...unsent, voidedAt: new Date(0) })).toBe('void')
})
