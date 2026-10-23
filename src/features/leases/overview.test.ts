/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  daysUntil,
  formatShortDate,
  inDays,
  leaseOverview,
  leaseTimeline,
  monthlyRentOre,
  rentUnit,
  unitSummary,
} from './overview'
import type { LeaseStatus } from './terms'

const today = '2026-10-23'
const base = {
  startDate: '2025-08-01',
  endDate: null as string | null,
  extensionMonths: null as number | null,
  noticePeriodMonths: 3,
  moveOutDate: null as string | null,
  status: 'active' as LeaseStatus,
}

describe('leaseTimeline', () => {
  test('open-ended and running', () => {
    expect(leaseTimeline(base, today)).toEqual({
      period: '2025-08-01 → tillsvidare',
      cardPeriod: 'Från 2025-08-01 · tillsvidare',
      progress: null,
      note: 'Löpande',
      tone: 'neutral',
    })
  })

  test('upcoming counts the days to the start', () => {
    const t = leaseTimeline({ ...base, startDate: '2026-11-01', status: 'upcoming' }, today)
    expect(t).toMatchObject({ note: 'Startar om 9 dagar', tone: 'upcoming', progress: null })
  })

  test('terminated counts the days to the move-out and shows progress', () => {
    const t = leaseTimeline(
      { ...base, startDate: '2024-04-01', moveOutDate: '2026-12-31', status: 'terminated' },
      today,
    )
    expect(t.period).toBe('2024-04-01 → 2026-12-31')
    expect(t.cardPeriod).toBe('2024-04-01 – 2026-12-31')
    expect(t.note).toBe('Upphör om 69 dagar')
    expect(t.tone).toBe('ending')
    expect(t.progress).toBeCloseTo(935 / 1004, 3)
  })

  test('fixed term that renews', () => {
    const t = leaseTimeline(
      { ...base, startDate: '2024-01-01', endDate: '2026-12-31', extensionMonths: 36 },
      today,
    )
    expect(t).toMatchObject({
      period: '2024-01-01 → 2026-12-31',
      note: 'Förlängs 36 mån om ej uppsagt',
      tone: 'renewing',
    })
    expect(t.progress).toBeGreaterThan(0.9)
  })

  test('fixed term without renewal ends by itself', () => {
    const t = leaseTimeline({ ...base, endDate: '2026-10-24' }, today)
    expect(t).toMatchObject({ note: 'Upphör i morgon', tone: 'ending' })
  })

  test('ended', () => {
    const t = leaseTimeline({ ...base, moveOutDate: '2026-01-31', status: 'ended' }, today)
    expect(t).toMatchObject({ note: 'Avslutat 2026-01-31', progress: 1, tone: 'neutral' })
  })
})

test('daysUntil and inDays', () => {
  expect(daysUntil(today, today)).toBe(0)
  expect(daysUntil(today, '2026-11-01')).toBe(9)
  expect(daysUntil(today, '2026-10-20')).toBe(-3)
  expect(inDays(0)).toBe('i dag')
  expect(inDays(1)).toBe('i morgon')
  expect(inDays(69)).toBe('om 69 dagar')
})

test('formatShortDate', () => {
  expect(formatShortDate('2026-11-01')).toBe('1 nov')
  expect(formatShortDate('2026-12-31')).toBe('31 dec')
})

test('unitSummary', () => {
  expect(
    unitSummary([
      { kind: 'commercial', label: '2001', designation: 'Uppsala Kungsängen 12:3' },
      { kind: 'parking', label: 'P1', designation: 'Uppsala Kungsängen 12:3' },
    ]),
  ).toEqual({ designations: 'Uppsala Kungsängen 12:3', labels: ['Lokal 2001', 'P-plats P1'] })
})

test('rentUnit and monthlyRentOre', () => {
  expect(rentUnit({ rentInterval: 'monthly', vat: false })).toBe('per månad')
  expect(rentUnit({ rentInterval: 'yearly', vat: true })).toBe('per år + moms')
  expect(monthlyRentOre({ rentOre: 18000000, rentInterval: 'yearly' })).toBe(1500000)
  expect(monthlyRentOre({ rentOre: 845000, rentInterval: 'monthly' })).toBe(845000)
})

test('leaseOverview matches the seed company', () => {
  const leases = [
    { ...base, rentOre: 845000, rentInterval: 'monthly' as const },
    {
      ...base,
      startDate: '2024-01-01',
      endDate: '2026-12-31',
      extensionMonths: 36,
      rentOre: 18000000,
      rentInterval: 'yearly' as const,
    },
    {
      ...base,
      startDate: '2024-04-01',
      moveOutDate: '2026-12-31',
      status: 'terminated' as LeaseStatus,
      rentOre: 720000,
      rentInterval: 'monthly' as const,
    },
    {
      ...base,
      startDate: '2026-11-01',
      status: 'upcoming' as LeaseStatus,
      rentOre: 690000,
      rentInterval: 'monthly' as const,
    },
  ]
  expect(leaseOverview(leases, today)).toEqual({
    counts: { all: 4, active: 2, upcoming: 1, terminated: 1, ended: 0 },
    currentMonthlyRentOre: 845000 + 1500000 + 720000,
    openEndedActive: 1,
    nextStart: { date: '2026-11-01', days: 9 },
    nextEnd: { date: '2026-12-31', days: 69 },
  })
})
