import { isLuhnValid } from '#/lib/luhn'

// Organisationsnummer: ten digits, conventionally written NNNNNN-NNNN, where the last digit is a
// Luhn check digit. A twelve-digit form with a "16" prefix also occurs and is accepted.

function digitsOf(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '')
  if (/^16\d{10}$/.test(digits)) return digits.slice(2)
  return /^\d{10}$/.test(digits) ? digits : null
}

export function isValidOrganizationNumber(input: string): boolean {
  const digits = digitsOf(input)
  return digits !== null && isLuhnValid(digits)
}

/** "5566778899" → "556677-8899". Call only on valid input. */
export function formatOrganizationNumber(input: string): string {
  const digits = digitsOf(input)
  if (!digits) throw new Error(`Invalid organisationsnummer: ${input}`)
  return `${digits.slice(0, 6)}-${digits.slice(6)}`
}
