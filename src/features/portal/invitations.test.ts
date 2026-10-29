import { expect, test } from 'bun:test'
import { invitationStatus, normalizeEmail } from './invitations'

const at = (iso: string) => new Date(iso)
const now = at('2026-10-29T12:00:00Z').getTime()

test('an invitation is pending until it expires, then expired', () => {
  const base = { acceptedAt: null, revokedAt: null }
  expect(invitationStatus({ ...base, expiresAt: at('2026-11-01T00:00:00Z') }, now)).toBe('pending')
  expect(invitationStatus({ ...base, expiresAt: at('2026-10-29T12:00:00Z') }, now)).toBe('expired')
})

test('used and withdrawn invitations say so, whatever the date', () => {
  const expiresAt = at('2026-10-01T00:00:00Z')
  expect(invitationStatus({ acceptedAt: at('2026-09-30'), revokedAt: null, expiresAt }, now)).toBe(
    'accepted',
  )
  expect(invitationStatus({ acceptedAt: null, revokedAt: at('2026-09-30'), expiresAt }, now)).toBe(
    'revoked',
  )
})

test('email addresses compare without case or space', () => {
  expect(normalizeEmail('  Anna@Exempel.SE ')).toBe('anna@exempel.se')
})
