import { effectiveEndDate, type LeaseTerms } from '#/features/leases/terms'
import {
  addDays,
  addMonths,
  daysBetweenInclusive,
  endOfMonth,
  lastWeekdayBefore,
  maxDate,
  minDate,
} from '#/lib/dates'
import { isLuhnValid, luhnCheckDigit } from '#/lib/luhn'

// Pure invoicing rules, shared by the server (runs) and the client (previews and labels).

export interface Period {
  readonly start: string
  readonly end: string
}

export interface RentTerms extends LeaseTerms {
  readonly rentOre: number
  readonly rentInterval: 'monthly' | 'yearly'
  readonly invoiceInterval: 'monthly' | 'quarterly'
  readonly vat: boolean
}

/** An invoice run is chosen by month ("2026-12"). */
export const isInvoiceMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

/**
 * The period a lease is invoiced for in a run for `month`: that month for monthly invoicing; the
 * quarter starting that month for quarterly invoicing, which is only invoiced in Jan/Apr/Jul/Oct.
 */
export function invoicePeriod(
  month: string,
  interval: RentTerms['invoiceInterval'],
): Period | null {
  const start = `${month}-01`
  if (interval === 'monthly') return { start, end: endOfMonth(start) }
  const monthNumber = Number(month.slice(5, 7))
  if ((monthNumber - 1) % 3 !== 0) return null
  return { start, end: endOfMonth(addMonths(start, 2)) }
}

/**
 * The full rent for one calendar month. Yearly rent is split so that the twelve months always add
 * up to exactly the yearly amount: 100 000,00 kr becomes 8 333,33 or 8 333,34 per month.
 */
function monthlyRent(terms: RentTerms, monthStart: string): number {
  if (terms.rentInterval === 'monthly') return terms.rentOre
  const m = Number(monthStart.slice(5, 7))
  return Math.floor((terms.rentOre * m) / 12) - Math.floor((terms.rentOre * (m - 1)) / 12)
}

/**
 * Rent for `period`, month by month. A month the lease only partly covers is charged per day
 * (rounded to the öre), so move-ins and move-outs mid-month cost exactly what they should.
 */
export function rentForPeriod(terms: RentTerms, period: Period): number {
  const leaseStart = terms.startDate
  const leaseEnd = effectiveEndDate(terms)
  let total = 0
  for (let month = period.start; month <= period.end; month = addMonths(month, 1)) {
    const monthEnd = endOfMonth(month)
    const from = maxDate(month, leaseStart)
    const to = leaseEnd ? minDate(monthEnd, leaseEnd) : monthEnd
    const covered = daysBetweenInclusive(from, to)
    if (covered === 0) continue
    const full = monthlyRent(terms, month)
    const days = daysBetweenInclusive(month, monthEnd)
    total += covered === days ? full : Math.round((full * covered) / days)
  }
  return total
}

export const VAT_RATE_PERCENT = 25

export const vatFor = (netOre: number, vat: boolean) =>
  vat ? Math.round((netOre * VAT_RATE_PERCENT) / 100) : 0

/** Rent is paid in advance: by the last weekday before the period, but never sooner than 10 days. */
export function dueDate(period: Period, issueDate: string): string {
  return maxDate(lastWeekdayBefore(period.start), addDays(issueDate, 10))
}

/** OCR reference: the invoice number followed by a Luhn check digit (Bankgirot's variable length). */
export const ocrFor = (invoiceNumber: number) =>
  `${invoiceNumber}${luhnCheckDigit(String(invoiceNumber))}`

/** Bankgiro numbers have seven or eight digits, written NNN-NNNN or NNNN-NNNN, with a check digit. */
export function isValidBankgiro(input: string): boolean {
  const digits = input.replace(/[\s-]/g, '')
  return /^\d{7,8}$/.test(digits) && isLuhnValid(digits)
}

export function formatBankgiro(input: string): string {
  const digits = input.replace(/[\s-]/g, '')
  return `${digits.slice(0, -4)}-${digits.slice(-4)}`
}

/** Momsregistreringsnummer derived from the organisationsnummer: SE + ten digits + 01. */
export const vatNumberFor = (organizationNumber: string) =>
  `SE${organizationNumber.replace(/\D/g, '')}01`

export type InvoiceStatus = 'void' | 'paid' | 'overdue' | 'unpaid'

export function invoiceStatus(
  invoice: { voidedAt: Date | null; paidOn: string | null; dueDate: string },
  today: string,
): InvoiceStatus {
  if (invoice.voidedAt) return 'void'
  if (invoice.paidOn) return 'paid'
  return invoice.dueDate < today ? 'overdue' : 'unpaid'
}

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  unpaid: 'Obetald',
  overdue: 'Förfallen',
  paid: 'Betald',
  void: 'Makulerad',
}

const monthName = new Intl.DateTimeFormat('sv-SE', { month: 'long', timeZone: 'UTC' })
const monthOf = (date: string) => monthName.format(new Date(`${date}T00:00:00Z`))

/** "december 2026", or "januari–mars 2027" for a quarter. */
export function periodLabel(period: Period): string {
  const year = period.end.slice(0, 4)
  if (period.start.slice(0, 7) === period.end.slice(0, 7)) return `${monthOf(period.start)} ${year}`
  return `${monthOf(period.start)}–${monthOf(period.end)} ${year}`
}
