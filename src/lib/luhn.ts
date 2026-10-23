// Luhn (mod 10), the check-digit scheme behind organisationsnummer, bankgiro numbers and OCR
// payment references. Digits are weighted 2, 1, 2, 1… from the right, excluding the check digit.

function weightedSum(digits: string, doubleFirst: boolean): number {
  let sum = 0
  let double = doubleFirst
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (double) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    double = !double
  }
  return sum
}

/** The digit to append to `digits` so the whole number passes the Luhn check. */
export function luhnCheckDigit(digits: string): number {
  return (10 - (weightedSum(digits, true) % 10)) % 10
}

/** Whether `digits` (check digit included, last) passes the Luhn check. */
export function isLuhnValid(digits: string): boolean {
  return /^\d+$/.test(digits) && weightedSum(digits, false) % 10 === 0
}
