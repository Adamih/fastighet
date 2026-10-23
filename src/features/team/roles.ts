import { can } from '#/lib/permissions'

// Organization roles and permission-based member actions shared with the team UI.

export const roles = ['owner', 'admin', 'member'] as const
export type Role = (typeof roles)[number]

export const roleLabels: Record<string, string> = {
  owner: 'Ägare',
  admin: 'Administratör',
  member: 'Medlem',
}

export const invitableRoles = ['member', 'admin'] as const
export type InvitableRole = (typeof invitableRoles)[number]

export interface MemberActions {
  /** Roles the actor may switch the target to (includes the current one). Empty = no change. */
  readonly roleOptions: readonly Role[]
  readonly canRemove: boolean
}

const none: MemberActions = { roleOptions: [], canRemove: false }

/** Member permissions apply to every target and assignable role. Self-service is separate. */
export function memberActions(input: { actorRole: string; isSelf: boolean }): MemberActions {
  const { actorRole, isSelf } = input
  if (isSelf) return none
  return {
    roleOptions: can(actorRole, { member: ['update'] }) ? roles : [],
    canRemove: can(actorRole, { member: ['delete'] }),
  }
}
