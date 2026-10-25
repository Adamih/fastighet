import type { LeaseTerms } from '#/features/leases/terms'

// Pure helpers that let lease rules (status, occupancy, availability) work for every kind of
// agreement. Client-safe.

interface AgreementWithTerms {
  readonly startDate: string
  readonly endDate: string | null
  readonly leaseTerms: {
    readonly termEndDate: string | null
    readonly extensionMonths: number | null
    readonly noticePeriodMonths: number
    readonly noticeDate: string | null
    readonly moveOutDate: string | null
  } | null
}

/**
 * Lease-shaped terms for an agreement. A lease uses its own; a bostadsrätt runs until it is
 * transferred, which works like a lease with that day as its move-out.
 */
export function agreementTerms(agreement: AgreementWithTerms): LeaseTerms & {
  noticeDate: string | null
} {
  const terms = agreement.leaseTerms
  if (terms) return { startDate: agreement.startDate, ...terms }
  return {
    startDate: agreement.startDate,
    termEndDate: null,
    extensionMonths: null,
    noticePeriodMonths: 0,
    noticeDate: null,
    moveOutDate: agreement.endDate,
  }
}
