import { authClient } from '#/lib/auth-client'
import type { roles as permissionRoles } from '#/lib/permissions'

// UI controls mirror Better Auth endpoints, including their creator-role protections.

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

/** Better Auth stores several roles as a comma-separated membership string. */
export const isOwner = (role: string) => role.split(',').includes('owner')

/** Self-service stays hidden; the endpoints enforce their own owner protections. */
export function memberActions(input: {
  actorRole: string
  targetRole: string
  isSelf: boolean
  ownerCount: number
}): MemberActions {
  const { actorRole, targetRole, isSelf, ownerCount } = input
  if (isSelf) return none
  const actorIsOwner = isOwner(actorRole)
  const targetIsOwner = isOwner(targetRole)
  if (targetIsOwner && !actorIsOwner) return none
  const role = actorRole as keyof typeof permissionRoles
  return {
    // Better Auth permits demoting another owner even if they are the last one.
    roleOptions: authClient.organization.checkRolePermission({
      role,
      permissions: { member: ['update'] },
    })
      ? actorIsOwner
        ? roles
        : invitableRoles
      : [],
    canRemove:
      (!targetIsOwner || ownerCount > 1) &&
      authClient.organization.checkRolePermission({ role, permissions: { member: ['delete'] } }),
  }
}
