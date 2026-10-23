// Calendar dates are ISO strings ("2026-10-23") everywhere: database, server functions and UI.
// They carry no time zone and compare correctly as plain strings.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const toIso = (utc: Date) => utc.toISOString().slice(0, 10)

function parts(date: string): [year: number, month: number, day: number] {
  const match = ISO_DATE.exec(date)
  if (!match) throw new Error(`Not an ISO date: ${date}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

export function isIsoDate(input: string): boolean {
  const match = ISO_DATE.exec(input)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/** Adds calendar months, clamping to the last day of shorter months (2026-01-31 + 1 → 2026-02-28). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = parts(date)
  const first = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = daysInMonth(first.getUTCFullYear(), first.getUTCMonth() + 1)
  first.setUTCDate(Math.min(day, lastDay))
  return toIso(first)
}

export function endOfMonth(date: string): string {
  const [year, month] = parts(date)
  return toIso(new Date(Date.UTC(year, month - 1, daysInMonth(year, month))))
}

const stockholmFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The calendar date in Sweden at the given instant. Workers run in UTC, so never use `new Date()` alone. */
export function stockholmDate(epochMillis: number): string {
  return stockholmFormat.format(epochMillis)
}
