import { and, asc, eq, gt } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { invitation, member, user } from '#/db/schema'
import { requirePermission } from '#/server/authorize'
import { Forbidden, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { CurrentUser } from '#/server/services'
import type { UpdateMemberRoleInput } from './schemas'

export const getTeam = Effect.gen(function* () {
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

/** Scope the target to the active company and keep self-service out of team management. */
const loadManageableMember = (memberId: string) =>
  Effect.gen(function* () {
    const me = yield* CurrentUser
    const target = yield* orgQuery((db, organizationId) =>
      db.query.member.findFirst({
        where: and(eq(member.id, memberId), eq(member.organizationId, organizationId)),
      }),
    )
    if (!target) return yield* new NotFound({ entity: 'member', id: memberId })
    if (target.userId === me.id) return yield* new Forbidden()
    return target
  })

export const updateMemberRole = (input: UpdateMemberRoleInput) =>
  Effect.gen(function* () {
    yield* requirePermission({ member: ['update'] })
    const target = yield* loadManageableMember(input.memberId)
    yield* orgQuery((db, organizationId) =>
      db
        .update(member)
        .set({ role: input.role })
        .where(and(eq(member.id, target.id), eq(member.organizationId, organizationId))),
    )
  })

export const removeMember = (memberId: string) =>
  Effect.gen(function* () {
    yield* requirePermission({ member: ['delete'] })
    const target = yield* loadManageableMember(memberId)
    yield* orgQuery((db, organizationId) =>
      db
        .delete(member)
        .where(and(eq(member.id, target.id), eq(member.organizationId, organizationId))),
    )
  })
