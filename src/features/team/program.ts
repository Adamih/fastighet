import { and, asc, eq, gt } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { invitation, member, user } from '#/db/schema'
import { orgQuery } from '#/server/scoped'

export const getTeam = Effect.gen(function* () {
  const members = yield* orgQuery((db, organizationId) =>
    db
      .select({ id: member.id, role: member.role, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId))
      .orderBy(asc(user.name)),
  )

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
