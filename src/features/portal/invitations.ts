// Pure rules for portal invitations, shared by the server and the tenant page. Client-safe.

/** How long an invitation link works. */
export const INVITATION_DAYS = 14

export type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked'

/** Where an invitation stands at `now` (ms): used and withdrawn ones first, then the date. */
export function invitationStatus(
  invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: number,
): InvitationStatus {
  if (invitation.acceptedAt) return 'accepted'
  if (invitation.revokedAt) return 'revoked'
  return invitation.expiresAt.getTime() <= now ? 'expired' : 'pending'
}

/** Email addresses compare without case or surrounding space. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase()
