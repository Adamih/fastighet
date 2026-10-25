import { expect, test } from 'bun:test'
import { effectiveEndDate, leaseStatus } from '#/features/leases/terms'
import { agreementTerms } from './terms'

const today = '2026-10-24'

test('a lease keeps its own terms', () => {
  const terms = agreementTerms({
    startDate: '2024-01-01',
    endDate: null,
    leaseTerms: {
      termEndDate: '2026-12-31',
      extensionMonths: 36,
      noticePeriodMonths: 9,
      noticeDate: null,
      moveOutDate: null,
    },
  })
  expect(terms.termEndDate).toBe('2026-12-31')
  expect(leaseStatus(terms, today)).toBe('active')
})

test('a bostadsrätt ends when it is transferred', () => {
  const owned = { startDate: '2020-05-01', endDate: null, leaseTerms: null }
  expect(leaseStatus(agreementTerms(owned), today)).toBe('active')
  const sold = agreementTerms({ ...owned, endDate: '2026-11-30' })
  expect(effectiveEndDate(sold)).toBe('2026-11-30')
  expect(leaseStatus(sold, today)).toBe('terminated')
})
