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

export const canManageTeam = (role: string) => role === 'owner' || role === 'admin'

export interface MemberActions {
  /** Roles the actor may switch the target to (includes the current one). Empty = no change. */
  readonly roleOptions: readonly Role[]
  readonly canRemove: boolean
}

const none: MemberActions = { roleOptions: [], canRemove: false }

/**
 * What `actorRole` may do to a member with `targetRole`:
 * - Only owners may touch owners or make someone an owner.
 * - Admins manage admins and members.
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
  if (isSelf || !canManageTeam(actorRole)) return none

  if (targetRole === 'owner') {
    if (actorRole !== 'owner') return none
    const lastOwner = ownerCount <= 1
    return { roleOptions: lastOwner ? [] : roles, canRemove: !lastOwner }
  }

  return {
    roleOptions: actorRole === 'owner' ? roles : (['admin', 'member'] as const),
    canRemove: true,
  }
}
