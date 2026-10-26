// Request codes: 10 characters in two groups ("KX7PM-4QDRT"), about 50 bits, from an alphabet
// without look-alikes (no 0/O or 1/I), so they can be read out over the phone. Stored only as a
// SHA-256 hash; failed attempts to enter one are limited (`program.ts`).

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LENGTH = 10

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH))
  // 256 is a multiple of 32, so every character is equally likely.
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`
}

/** The code as typed, in canonical form, or null when it can't be a code. Case, spaces and dashes don't matter. */
export function normalizeCode(input: string): string | null {
  const chars = input.toUpperCase().replace(/[\s-]/g, '')
  if (chars.length !== LENGTH || [...chars].some((c) => !ALPHABET.includes(c))) return null
  return `${chars.slice(0, 5)}-${chars.slice(5)}`
}

export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
