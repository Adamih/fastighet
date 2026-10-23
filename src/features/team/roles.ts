// Better Auth organization roles. Only owners and admins may invite or cancel invitations.

export const roleLabels: Record<string, string> = {
  owner: 'Ägare',
  admin: 'Administratör',
  member: 'Medlem',
}

export const invitableRoles = ['member', 'admin'] as const
export type InvitableRole = (typeof invitableRoles)[number]

export const canManageTeam = (role: string) => role === 'owner' || role === 'admin'
