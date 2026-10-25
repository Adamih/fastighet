import { expect, test } from 'bun:test'
import { inForce, refundProblem, refunds, reissueProblem, voidProblem } from './correction'

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

test('refunds counts only credit notes on paid invoices', () => {
  expect(
    refunds([
      { totalOre: 100000, refund: false, refundedOn: null },
      { totalOre: 150000, refund: true, refundedOn: null },
      { totalOre: 50000, refund: true, refundedOn: '2026-10-01' },
    ]),
  ).toEqual({ refundDueOre: 150000, refundedOre: 50000 })
  expect(refunds([])).toEqual({ refundDueOre: 0, refundedOre: 0 })
})

test('a refund is recorded once, between the credit note and today', () => {
  const note = { totalOre: 150000, refund: true, refundedOn: null, issueDate: '2026-10-10' }
  const today = '2026-10-24'
  expect(refundProblem(note, '2026-10-20', today)).toBeNull()
  expect(refundProblem(note, '2026-10-10', today)).toBeNull()
  expect(refundProblem(note, '2026-10-25', today)).toBe('future')
  expect(refundProblem(note, '2026-10-09', today)).toBe('before_credit')
  expect(refundProblem({ ...note, refund: false }, '2026-10-20', today)).toBe('not_refund')
  expect(refundProblem({ ...note, refundedOn: '2026-10-12' }, '2026-10-20', today)).toBe(
    'already_refunded',
  )
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
  const unsent = { voidedAt: null, paidOn: null, creditedOre: 0, sentAt: null }
  expect(voidProblem(unsent)).toBeNull()
  expect(voidProblem({ ...unsent, sentAt: new Date(0) })).toBe('sent')
  expect(voidProblem({ ...unsent, creditedOre: 100000 })).toBe('credited')
  expect(voidProblem({ ...unsent, paidOn: '2026-10-01' })).toBe('paid')
  expect(voidProblem({ ...unsent, voidedAt: new Date(0) })).toBe('void')
})
