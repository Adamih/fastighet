import type { UnitKind } from '#/features/properties/unit-kinds'
import { daysBetweenInclusive } from '#/lib/dates'
import { m } from '#/paraglide/messages'
import { type RentInterval, rentIntervalLabels } from './options'
import { effectiveEndDate, type LeaseStatus, type LeaseTerms } from './terms'

// Pure presentation rules for the lease list: the period line, progress bar, status note,
// unit labels and summary figures. Shared by the desktop table and the phone cards.

/** Short unit labels as they are written on Swedish contracts. */
const unitPrefix: Record<UnitKind, string> = {
  get apartment() {
    return m.unit_prefix_apartment()
  },
  get commercial() {
    return m.unit_prefix_commercial()
  },
  get parking() {
    return m.unit_prefix_parking()
  },
  get storage() {
    return m.unit_prefix_storage()
  },
}

export const unitLabel = (unit: { kind: UnitKind; label: string }) =>
  `${unitPrefix[unit.kind]} ${unit.label}`

/** The properties a lease covers (usually one) and its units as short labels. */
export function unitSummary(
  units: readonly { kind: UnitKind; label: string; designation: string }[],
) {
  return {
    designations: [...new Set(units.map((u) => u.designation))].join(', '),
    labels: units.map(unitLabel),
  }
}

/** Whole days from `today` until `date` (0 = today). */
export const daysUntil = (today: string, date: string) =>
  date >= today ? daysBetweenInclusive(today, date) - 1 : -(daysBetweenInclusive(date, today) - 1)

export function inDays(days: number): string {
  if (days === 0) return m.common_today()
  if (days === 1) return m.common_tomorrow()
  return m.common_in_days({ days })
}

const shortDate = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
/** "1 nov", "31 dec" */
export const formatShortDate = (date: string) =>
  shortDate.format(new Date(`${date}T00:00:00Z`)).replace('.', '')

export type TimelineTone = 'upcoming' | 'ending' | 'renewing' | 'neutral'

export interface Timeline {
  /** "2026-11-01 → tillsvidare" */
  readonly period: string
  /** The period on phone cards: "Från 2026-11-01 · tillsvidare", "2024-04-01 – 2026-12-31" */
  readonly cardPeriod: string
  /** Share of a bounded period that has passed, 0–1; null when the lease has no end yet. */
  readonly progress: number | null
  readonly note: string
  readonly tone: TimelineTone
}

export function leaseTimeline(
  lease: LeaseTerms & { status: LeaseStatus },
  today: string,
): Timeline {
  const end = effectiveEndDate(lease) ?? lease.endDate
  const period = end
    ? `${lease.startDate} → ${end}`
    : m.lease_period_open({ start: lease.startDate })
  const cardPeriod = end
    ? `${lease.startDate} – ${end}`
    : m.lease_card_period_open({ start: lease.startDate })
  const progress =
    end && lease.status !== 'upcoming'
      ? Math.min(
          1,
          Math.max(
            0,
            (daysBetweenInclusive(lease.startDate, today) - 1) /
              Math.max(1, daysBetweenInclusive(lease.startDate, end) - 1),
          ),
        )
      : null

  if (lease.status === 'upcoming') {
    return {
      period,
      cardPeriod,
      progress: null,
      note: m.lease_note_starts({ when: inDays(daysUntil(today, lease.startDate)) }),
      tone: 'upcoming',
    }
  }
  if (lease.status === 'ended') {
    return {
      period,
      cardPeriod,
      progress: 1,
      note: m.lease_note_ended({ date: end ?? '' }),
      tone: 'neutral',
    }
  }
  if (lease.moveOutDate) {
    return {
      period,
      cardPeriod,
      progress,
      note: m.lease_note_ends({ when: inDays(daysUntil(today, lease.moveOutDate)) }),
      tone: 'ending',
    }
  }
  if (lease.endDate && lease.extensionMonths) {
    return {
      period,
      cardPeriod,
      progress,
      note: m.lease_note_renews({ months: lease.extensionMonths }),
      tone: 'renewing',
    }
  }
  if (lease.endDate) {
    return {
      period,
      cardPeriod,
      progress,
      note: m.lease_note_ends({ when: inDays(daysUntil(today, lease.endDate)) }),
      tone: 'ending',
    }
  }
  return { period, cardPeriod, progress: null, note: m.lease_note_running(), tone: 'neutral' }
}

/** "per månad", "per år + moms" */
export const rentUnit = (lease: { rentInterval: RentInterval; vat: boolean }) =>
  lease.vat
    ? m.rent_unit_with_vat({ interval: rentIntervalLabels[lease.rentInterval] })
    : rentIntervalLabels[lease.rentInterval]

/** Rent per month excluding VAT; yearly rent is divided by twelve and rounded to the öre. */
export const monthlyRentOre = (lease: { rentOre: number; rentInterval: RentInterval }) =>
  lease.rentInterval === 'monthly' ? lease.rentOre : Math.round(lease.rentOre / 12)

type OverviewLease = LeaseTerms & {
  status: LeaseStatus
  rentOre: number
  rentInterval: RentInterval
}

/** Figures for the summary cards above the list. */
export function leaseOverview(leases: readonly OverviewLease[], today: string) {
  const by = (status: LeaseStatus) => leases.filter((l) => l.status === status)
  const active = by('active')
  const upcoming = by('upcoming')
  const terminated = by('terminated')
  const soonest = (dates: string[]) => dates.sort()[0] ?? null

  const nextStart = soonest(upcoming.map((l) => l.startDate))
  const nextEnd = soonest(
    terminated.map((l) => l.moveOutDate).filter((d): d is string => d !== null),
  )
  return {
    counts: {
      all: leases.length,
      active: active.length,
      upcoming: upcoming.length,
      terminated: terminated.length,
      ended: by('ended').length,
    },
    /** Rent from leases that run today: current ones, including those under notice. */
    currentMonthlyRentOre: [...active, ...terminated].reduce(
      (sum, l) => sum + monthlyRentOre(l),
      0,
    ),
    openEndedActive: active.filter((l) => l.endDate === null).length,
    nextStart: nextStart && { date: nextStart, days: daysUntil(today, nextStart) },
    nextEnd: nextEnd && { date: nextEnd, days: daysUntil(today, nextEnd) },
  }
}
