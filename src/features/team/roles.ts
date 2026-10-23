import { can } from '#/lib/permissions'

// Better Auth organization roles. Better Auth enforces the rules on the server; `memberActions`
// mirrors them so the UI only offers what will succeed.

export const roles = ['owner', 'admin', 'member'] as const
export type Role = (typeof roles)[number]

export const roleLabels: Record<string, string> = {
  owner: 'Ägare',
  admin: 'Administratör',
  member: 'Medlem',
}

export const invitableRoles = ['member', 'admin'] as const
export type InvitableRole = (typeof invitableRoles)[number]

/** Better Auth stores multiple roles as a comma-separated string. */
export const isOwner = (role: string) => role.split(',').some((r) => r.trim() === 'owner')

export interface MemberActions {
  /** Roles the actor may switch the target to (includes the current one). Empty = no change. */
  readonly roleOptions: readonly Role[]
  readonly canRemove: boolean
}

const none: MemberActions = { roleOptions: [], canRemove: false }

/**
 * What `actorRole` may do to a member with `targetRole`:
 * - Changing roles needs `member:update`, removing needs `member:delete`.
 * - Only owners may touch owners or make someone an owner. Better Auth ties this to the
 *   creator role ("owner") rather than to a permission, so it stays a role check.
 * - The last owner can be neither removed nor demoted.
 * - Your own row has no actions; changing your own access is a separate "leave" flow.
 */
export function memberActions(input: {
  actorRole: string
  targetRole: string
  isSelf: boolean
  ownerCount: number
}): MemberActions {
  const { actorRole, targetRole, isSelf, ownerCount } = input
  if (isSelf) return none
  const mayUpdate = can(actorRole, { member: ['update'] })
  const mayRemove = can(actorRole, { member: ['delete'] })
  const actorIsOwner = isOwner(actorRole)

  if (isOwner(targetRole)) {
    if (!actorIsOwner || ownerCount <= 1) return none
    return { roleOptions: mayUpdate ? roles : [], canRemove: mayRemove }
  }
  return {
    roleOptions: mayUpdate ? (actorIsOwner ? roles : (['admin', 'member'] as const)) : [],
    canRemove: mayRemove,
  }
}
