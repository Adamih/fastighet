import { hashCode } from '#/features/management/codes'

// Invitation codes travel only in the emailed link, never typed, so they are long: 32 random
// bytes, base64url. Stored only as a SHA-256 hash, like management request codes.

export function generateInvitationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export const hashInvitationCode = hashCode
