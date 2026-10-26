import { and, asc, eq, gt } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { invitation, member, user } from '#/db/schema'
import { requireOwnCompany } from '#/server/authorize'
import { orgQuery } from '#/server/scoped'
import { CurrentUser } from '#/server/services'

export const getTeam = Effect.gen(function* () {
  // Open to every member, but never to another company's staff managing this one.
  yield* requireOwnCompany
  const me = yield* CurrentUser
  const rows = yield* orgQuery((db, organizationId) =>
    db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId))
      .orderBy(asc(user.name)),
  )
  const members = rows.map(({ userId, ...m }) => ({ ...m, isSelf: userId === me.id }))

  const now = new Date(yield* Clock.currentTimeMillis)
  const invitations = yield* orgQuery((db, organizationId) =>
    db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, now),
        ),
      )
      .orderBy(asc(invitation.email)),
  )

  return { members, invitations }
})
