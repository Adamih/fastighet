import { asc, desc, eq, isNull } from 'drizzle-orm'
import { Clock, Effect, Option } from 'effect'
import { auditEvent, party, partyAccess, portalInvitation, user } from '#/db/schema'
import { loadCompanyDetails } from '#/features/settings/program'
import { stockholmDate } from '#/lib/dates'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { bestEffort } from '#/server/best-effort'
import { Conflict } from '#/server/errors'
import { sendEmail } from '#/server/mail/mailer'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { CurrentOrganization, CurrentUser } from '#/server/services'
import { generateInvitationCode, hashInvitationCode } from './codes'
import { INVITATION_DAYS, invitationStatus, normalizeEmail } from './invitations'
import type { InvitePortalUserInput } from './schemas'

// The staff side of the portal: inviting a party's people to "Mina sidor", and seeing and ending
// their access. Portal users are never organization members (see `party_access`).

const read: Permissions = { tenant: ['read'] }
const manage: Permissions = { tenant: ['manage'] }
const DAY = 24 * 60 * 60 * 1000

const loadParty = (partyId: string) =>
  orgQuery((db, organizationId) =>
    db.query.party.findFirst({
      columns: { id: true, name: true },
      where: inCompany(party, organizationId, eq(party.id, partyId)),
    }),
  ).pipe(orNotFound('party', partyId))

/** Who has access to a party's pages, and the invitations sent that haven't been used. */
export const portalAccessFor = Effect.fn('portal.portalAccessFor')(function* (partyId: string) {
  yield* requirePermission(read)
  const found = yield* loadParty(partyId)
  const users = yield* orgQuery((db, organizationId) =>
    db
      .select({
        id: partyAccess.id,
        userId: partyAccess.userId,
        name: user.name,
        email: user.email,
        createdAt: partyAccess.createdAt,
      })
      .from(partyAccess)
      .innerJoin(user, eq(user.id, partyAccess.userId))
      .where(
        inCompany(
          partyAccess,
          organizationId,
          eq(partyAccess.partyId, found.id),
          isNull(partyAccess.revokedAt),
        ),
      )
      .orderBy(asc(partyAccess.createdAt)),
  )
  const invitations = yield* orgQuery((db, organizationId) =>
    db
      .select({
        id: portalInvitation.id,
        email: portalInvitation.email,
        createdAt: portalInvitation.createdAt,
        expiresAt: portalInvitation.expiresAt,
        acceptedAt: portalInvitation.acceptedAt,
        revokedAt: portalInvitation.revokedAt,
      })
      .from(portalInvitation)
      .where(
        inCompany(
          portalInvitation,
          organizationId,
          eq(portalInvitation.partyId, found.id),
          isNull(portalInvitation.acceptedAt),
          isNull(portalInvitation.revokedAt),
        ),
      )
      .orderBy(desc(portalInvitation.createdAt)),
  )
  // The latest change the party's people made to its contact details in Mina sidor.
  const [contactChange] = yield* orgQuery((db, organizationId) =>
    db
      .select({ at: auditEvent.createdAt, userName: auditEvent.userName })
      .from(auditEvent)
      .where(
        inCompany(
          auditEvent,
          organizationId,
          eq(auditEvent.action, 'portal.update_contact'),
          eq(auditEvent.entityId, found.id),
        ),
      )
      .orderBy(desc(auditEvent.createdAt))
      .limit(1),
  )
  const now = yield* Clock.currentTimeMillis
  return {
    lastContactChange: contactChange
      ? { on: stockholmDate(contactChange.at.getTime()), userName: contactChange.userName }
      : null,
    users: users.map((u) => ({ ...u, createdAt: u.createdAt.getTime() })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      sentOn: stockholmDate(i.createdAt.getTime()),
      expiresOn: stockholmDate(i.expiresAt.getTime()),
      status: invitationStatus(i, now) as 'pending' | 'expired',
    })),
  }
})

/** A new link code (shown only in the email) and when it stops working. */
const newCode = Effect.gen(function* () {
  const code = generateInvitationCode()
  return {
    code,
    codeHash: yield* Effect.promise(() => hashInvitationCode(code)),
    expiresAt: new Date((yield* Clock.currentTimeMillis) + INVITATION_DAYS * DAY),
  }
})

/** Emails an invitation's link. False when the email failed; the invitation stays. */
const emailInvitation = (
  invitation: { partyName: string; email: string },
  link: { code: string; expiresAt: Date },
  origin: string,
) =>
  Effect.gen(function* () {
    const { code, expiresAt } = link
    const company = yield* CurrentOrganization
    const details = yield* loadCompanyDetails
    const sent = yield* sendEmail({
      to: invitation.email,
      template: 'portalInvitation',
      props: {
        organizationName: company.name,
        partyName: invitation.partyName,
        partyNoun: details.kind === 'brf' ? 'medlem' : 'hyresgäst',
        acceptUrl: `${origin}/portal/invitation?code=${encodeURIComponent(code)}`,
        expiresOn: stockholmDate(expiresAt.getTime()),
      },
    }).pipe(bestEffort('Could not email portal invitation'))
    return Option.isSome(sent)
  })

/**
 * Invites someone to the party's pages: a link to `email`, valid for 14 days. Refused when that
 * address already has access or a pending invitation for the party.
 */
export const invitePortalUser = Effect.fn('portal.invitePortalUser')(function* (
  input: InvitePortalUserInput,
  origin: string,
) {
  yield* requirePermission(manage)
  const found = yield* loadParty(input.partyId)
  const email = normalizeEmail(input.email)
  const access = yield* portalAccessFor(found.id)
  if (access.users.some((u) => normalizeEmail(u.email) === email)) {
    return yield* new Conflict({ message: `${email} har redan tillgång till Mina sidor.` })
  }
  if (access.invitations.some((i) => i.email === email && i.status === 'pending')) {
    return yield* new Conflict({
      message: `${email} har redan en inbjudan. Skicka den igen i stället.`,
    })
  }
  const me = yield* CurrentUser
  const link = yield* newCode
  const [created] = yield* orgQuery((db, organizationId) =>
    db
      .insert(portalInvitation)
      .values({
        organizationId,
        partyId: found.id,
        email,
        codeHash: link.codeHash,
        expiresAt: link.expiresAt,
        createdBy: me.id,
      })
      .returning({ id: portalInvitation.id }),
  )
  const emailed = yield* emailInvitation({ partyName: found.name, email }, link, origin)
  return { id: created.id, emailed }
})

const loadOpenInvitation = (invitationId: string) =>
  Effect.gen(function* () {
    const row = yield* orgQuery((db, organizationId) =>
      db
        .select({
          id: portalInvitation.id,
          partyId: portalInvitation.partyId,
          partyName: party.name,
          email: portalInvitation.email,
        })
        .from(portalInvitation)
        // Party ids are unique, and the composite key keeps the party in the same company.
        .innerJoin(party, eq(party.id, portalInvitation.partyId))
        .where(
          inCompany(
            portalInvitation,
            organizationId,
            eq(portalInvitation.id, invitationId),
            isNull(portalInvitation.acceptedAt),
            isNull(portalInvitation.revokedAt),
          ),
        ),
    ).pipe(
      Effect.map(([found]) => found),
      orNotFound('portalInvitation', invitationId),
    )
    return row
  })

/** Sends a pending or expired invitation again, with a new code valid for another 14 days. */
export const resendPortalInvitation = Effect.fn('portal.resendPortalInvitation')(function* (
  invitationId: string,
  origin: string,
) {
  yield* requirePermission(manage)
  const invitation = yield* loadOpenInvitation(invitationId)
  const link = yield* newCode
  yield* orgQuery((db, organizationId) =>
    db
      .update(portalInvitation)
      .set({ codeHash: link.codeHash, expiresAt: link.expiresAt })
      .where(inCompany(portalInvitation, organizationId, eq(portalInvitation.id, invitation.id))),
  )
  const emailed = yield* emailInvitation(invitation, link, origin)
  return { id: invitation.id, emailed }
})

/** Withdraws an invitation that hasn't been used, so its link stops working. */
export const revokePortalInvitation = Effect.fn('portal.revokePortalInvitation')(function* (
  invitationId: string,
) {
  yield* requirePermission(manage)
  const invitation = yield* loadOpenInvitation(invitationId)
  const me = yield* CurrentUser
  const now = new Date(yield* Clock.currentTimeMillis)
  yield* orgQuery((db, organizationId) =>
    db
      .update(portalInvitation)
      .set({ revokedAt: now, revokedBy: me.id })
      .where(inCompany(portalInvitation, organizationId, eq(portalInvitation.id, invitation.id))),
  )
  return { id: invitation.id, partyId: invitation.partyId }
})

/** Ends a user's access to the party's pages. The link is kept, closed, as history. */
export const revokePortalAccess = Effect.fn('portal.revokePortalAccess')(function* (
  accessId: string,
) {
  yield* requirePermission(manage)
  const me = yield* CurrentUser
  const now = new Date(yield* Clock.currentTimeMillis)
  const [closed] = yield* orgQuery((db, organizationId) =>
    db
      .update(partyAccess)
      .set({ revokedAt: now, revokedBy: me.id })
      .where(
        inCompany(
          partyAccess,
          organizationId,
          eq(partyAccess.id, accessId),
          isNull(partyAccess.revokedAt),
        ),
      )
      .returning({ id: partyAccess.id, partyId: partyAccess.partyId }),
  )
  if (!closed) return yield* new Conflict({ message: 'Åtkomsten är redan borttagen.' })
  return closed
})
