import { addMonths, endOfMonth } from '#/lib/dates'

// Pure lease-term rules, shared by the server (validation) and the client (previews).

export interface LeaseTerms {
  readonly startDate: string
  /** Set for a fixed-term lease (tidsbestämt); null for an open-ended one (tillsvidare). */
  readonly termEndDate: string | null
  /** How long a fixed-term lease is extended when nobody gives notice in time (förlängning). */
  readonly extensionMonths: number | null
  readonly noticePeriodMonths: number
  readonly moveOutDate: string | null
}

export type LeaseStatus = 'upcoming' | 'active' | 'terminated' | 'ended'

/**
 * The last day of the lease, or null if it runs until someone gives notice. Stored as the
 * agreement's `endDate` (the last billed day) whenever the lease terms are written.
 */
export function effectiveEndDate(
  terms: Pick<LeaseTerms, 'termEndDate' | 'extensionMonths' | 'moveOutDate'>,
): string | null {
  if (terms.moveOutDate) return terms.moveOutDate
  return terms.termEndDate && !terms.extensionMonths ? terms.termEndDate : null
}

export function leaseStatus(terms: LeaseTerms, today: string): LeaseStatus {
  if (terms.startDate > today) return 'upcoming'
  const end = effectiveEndDate(terms)
  if (end && end < today) return 'ended'
  return terms.moveOutDate ? 'terminated' : 'active'
}

/**
 * The earliest last day of the lease if notice is given on `noticeDate`.
 *
 * Open-ended leases end at the month-end after the notice period has run (notice on 15 Jan with
 * three months ends the lease on 30 Apr). Fixed-term leases with an extension clause end at the
 * first term end that is at least a full notice period away; later term ends are reached by
 * stepping one extension at a time.
 */
export function earliestMoveOutDate(terms: LeaseTerms, noticeDate: string): string {
  const afterNotice = endOfMonth(addMonths(noticeDate, terms.noticePeriodMonths))
  if (!terms.termEndDate) return afterNotice
  if (!terms.extensionMonths) {
    return terms.termEndDate > afterNotice ? terms.termEndDate : afterNotice
  }

  let termEnd = terms.termEndDate
  while (addMonths(termEnd, -terms.noticePeriodMonths) < noticeDate) {
    termEnd = addMonths(termEnd, terms.extensionMonths)
  }
  return termEnd
}

/**
 * The lease that occupies a unit today, or else the next one to start. Ended leases are ignored.
 * Overlap validation guarantees at most one lease is current at a time.
 */
export function occupyingLease<L extends LeaseTerms>(leases: readonly L[], today: string) {
  const live = leases
    .map((lease) => ({ lease, status: leaseStatus(lease, today) }))
    .filter((l) => l.status !== 'ended')
    .sort((a, b) => a.lease.startDate.localeCompare(b.lease.startDate))
  return live.find((l) => l.status !== 'upcoming') ?? live[0] ?? null
}

/** Whether two periods share at least one day. A null end means the period never ends. */
export function periodsOverlap(
  a: { start: string; end: string | null },
  b: { start: string; end: string | null },
): boolean {
  return (b.end === null || a.start <= b.end) && (a.end === null || b.start <= a.end)
}
