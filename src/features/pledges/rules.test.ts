import { describe, expect, test } from 'bun:test'
import { activeOn, inPriorityOrder, registerProblem, releaseProblem } from './rules'

const pledge = (notifiedOn: string, releasedOn: string | null = null, createdAt = 0) => ({
  notifiedOn,
  releasedOn,
  createdAt,
})

describe('activeOn', () => {
  test('from the notice until the day before the release', () => {
    const p = pledge('2026-03-01', '2026-06-01')
    expect(activeOn(p, '2026-02-28')).toBe(false)
    expect(activeOn(p, '2026-03-01')).toBe(true)
    expect(activeOn(p, '2026-05-31')).toBe(true)
    expect(activeOn(p, '2026-06-01')).toBe(false)
    expect(activeOn(pledge('2026-03-01'), '2099-01-01')).toBe(true)
  })
})

describe('inPriorityOrder', () => {
  test('the earliest notice first; same day in registration order; released last', () => {
    const ordered = inPriorityOrder(
      [
        { ...pledge('2026-05-01'), id: 'c' },
        { ...pledge('2026-01-10', '2026-04-01'), id: 'old' },
        { ...pledge('2026-02-01', null, 2), id: 'b' },
        { ...pledge('2026-02-01', null, 1), id: 'a' },
        { ...pledge('2025-01-01', '2026-06-01'), id: 'newest-release' },
      ],
      '2026-10-26',
    )
    expect(ordered.map((p) => [p.id, p.priority])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['newest-release', null],
      ['old', null],
    ])
  })

  test('releasing the first pledge moves the others up', () => {
    const before = inPriorityOrder([pledge('2026-01-01'), pledge('2026-02-01')], '2026-03-01')
    expect(before.map((p) => p.priority)).toEqual([1, 2])
    const after = inPriorityOrder(
      [pledge('2026-01-01', '2026-03-01'), pledge('2026-02-01')],
      '2026-03-01',
    )
    expect(after.map((p) => [p.notifiedOn, p.priority])).toEqual([
      ['2026-02-01', 1],
      ['2026-01-01', null],
    ])
  })
})

describe('registerProblem', () => {
  test('a notice can be from before tillträde, never from the future or after a sale', () => {
    const today = '2026-10-26'
    expect(registerProblem({ endDate: null }, '2026-10-26', today)).toBeNull()
    expect(registerProblem({ endDate: null }, '2026-10-27', today)).toBe('future')
    expect(registerProblem({ endDate: '2026-06-30' }, '2026-06-30', today)).toBeNull()
    expect(registerProblem({ endDate: '2026-06-30' }, '2026-07-01', today)).toBe('ended')
  })
})

describe('releaseProblem', () => {
  test('once, not before the notice, not in the future', () => {
    const today = '2026-10-26'
    expect(releaseProblem(pledge('2026-03-01'), '2026-10-26', today)).toBeNull()
    expect(releaseProblem(pledge('2026-03-01'), '2026-03-01', today)).toBeNull()
    expect(releaseProblem(pledge('2026-03-01'), '2026-02-28', today)).toBe('before_notice')
    expect(releaseProblem(pledge('2026-03-01'), '2026-10-27', today)).toBe('future')
    expect(releaseProblem(pledge('2026-03-01', '2026-05-01'), '2026-10-26', today)).toBe('released')
  })
})
