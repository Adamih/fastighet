import { and, eq, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { auditEvent, organization, party, partyAccess, portalInvitation, user } from '#/db/schema'
import { portalAuditValues } from '#/server/audit'
import { Conflict } from '#/server/errors'
import { query } from '#/server/scoped'
import { hashInvitationCode } from './codes'
import { type InvitationStatus, invitationStatus, normalizeEmail } from './invitations'

// Accepting a portal invitation from the emailed link. The person may not have an account or be
// signed in, so there is no company in focus: the invitation is found by its secret code (across
// companies, like management request codes), and everything written uses its company.

const findByCode = (code: string) =>
  Effect.gen(function* () {
    const codeHash = yield* Effect.promise(() => hashInvitationCode(code))
    const [found] = yield* query((db) =>
      db
        .select({
          id: portalInvitation.id,
          organizationId: portalInvitation.organizationId,
          organizationName: organization.name,
          partyId: portalInvitation.partyId,
          partyName: party.name,
          partyKind: party.kind,
          email: portalInvitation.email,
          expiresAt: portalInvitation.expiresAt,
          acceptedAt: portalInvitation.acceptedAt,
          revokedAt: portalInvitation.revokedAt,
        })
        .from(portalInvitation)
        .innerJoin(organization, eq(organization.id, portalInvitation.organizationId))
        // Party ids are unique, and the composite key keeps the party in the invitation's company.
        .innerJoin(party, eq(party.id, portalInvitation.partyId))
        .where(eq(portalInvitation.codeHash, codeHash)),
    )
    if (!found) return null
    return { ...found, status: invitationStatus(found, yield* Clock.currentTimeMillis) }
  })

const problems: Record<Exclude<InvitationStatus, 'pending'>, string> = {
  expired: 'Inbjudan har gått ut. Be om en ny inbjudan.',
  accepted: 'Inbjudan är redan använd. Logga in på Mina sidor med din e-post.',
  revoked: 'Inbjudan har dragits tillbaka.',
}

/** What the invitation page shows before the person accepts. */
export const previewPortalInvitation = Effect.fn('portal.previewPortalInvitation')(function* (
  code: string,
) {
  const found = yield* findByCode(code)
  if (!found) return { ok: false as const, problem: 'Länken är ogiltig.' }
  if (found.status !== 'pending') return { ok: false as const, problem: problems[found.status] }
  return {
    ok: true as const,
    organizationName: found.organizationName,
    partyName: found.partyName,
    email: found.email,
  }
})

/**
 * Accepts the invitation for its email address: creates the account if there is none (with the
 * address verified, since the link was emailed to it, and no password), and gives it access to
 * the party's pages, all in one batch. Refused when someone else is signed in. The caller then
 * signs the person in to Mina sidor.
 */
export const acceptPortalInvitation = Effect.fn('portal.acceptPortalInvitation')(function* (
  code: string,
  signedInEmail: string | null,
) {
  const found = yield* findByCode(code)
  if (!found) return yield* new Conflict({ message: 'Länken är ogiltig.' })
  if (found.status !== 'pending') return yield* new Conflict({ message: problems[found.status] })
  if (signedInEmail !== null && normalizeEmail(signedInEmail) !== found.email) {
    return yield* new Conflict({
      message: `Du är inloggad som ${signedInEmail}, men inbjudan gäller ${found.email}. Logga ut först.`,
    })
  }
  const now = new Date(yield* Clock.currentTimeMillis)
  const [existing] = yield* query((db) =>
    db
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(sql`lower(${user.email})`, found.email)),
  )
  const userId = existing?.id ?? crypto.randomUUID()
  const name = found.partyKind === 'person' ? found.partyName : found.email
  yield* query((db) =>
    db.batch([
      existing
        ? db.update(user).set({ emailVerified: true }).where(eq(user.id, userId))
        : db.insert(user).values({
            id: userId,
            // A company's people name themselves later; a person is the party.
            name,
            email: found.email,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          }),
      db
        .update(portalInvitation)
        .set({ acceptedAt: now, acceptedBy: userId })
        .where(and(eq(portalInvitation.id, found.id), sql`${portalInvitation.acceptedAt} is null`)),
      // Already open (e.g. a second invitation to the same address): nothing to add.
      db
        .insert(partyAccess)
        .values({
          organizationId: found.organizationId,
          partyId: found.partyId,
          userId,
          invitationId: found.id,
          createdAt: now,
        })
        .onConflictDoNothing(),
      // The company's audit log, with the tenant as the actor.
      db.insert(auditEvent).values(
        portalAuditValues(
          {
            organizationId: found.organizationId,
            user: { id: userId, name },
            party: { id: found.partyId, name: found.partyName },
          },
          { action: 'portal.accept', entityId: found.partyId },
        ),
      ),
    ]),
  )
  return { email: found.email, userId, organizationId: found.organizationId }
})
