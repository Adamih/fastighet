// Amounts are integer öre (1 kr = 100 öre) everywhere outside of formatting and form input.

const AMOUNT = /^(\d+)(?:[.,](\d{1,2}))?$/

/** Parses user input such as "8 450", "8450,50" or "12 000.5" into öre. Returns null if invalid. */
export function parseSek(input: string): number | null {
  const match = AMOUNT.exec(input.replace(/[\s ]/g, ''))
  if (!match) return null
  const kronor = Number(match[1])
  const ore = Number((match[2] ?? '').padEnd(2, '0'))
  const total = kronor * 100 + ore
  return Number.isSafeInteger(total) ? total : null
}

const sekFormat = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' })

export function formatSek(ore: number): string {
  return sekFormat.format(ore / 100)
}

/** Öre as a plain form value: 845000 → "8450", 845050 → "8450,50". */
export function oreToInput(ore: number): string {
  const kronor = Math.trunc(ore / 100)
  const rest = ore % 100
  return rest === 0 ? String(kronor) : `${kronor},${String(rest).padStart(2, '0')}`
}
