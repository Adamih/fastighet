import { roleLabels } from '#/features/team/roles'
import { m } from '#/paraglide/messages'

// Client-safe wording for the admin dashboard.

/** "Admin · Spärrad" */
export const userBadges = (u: { isAdmin: boolean; banned: boolean }) =>
  [u.isAdmin && m.admin_badge_admin(), u.banned && m.admin_badge_banned()]
    .filter(Boolean)
    .join(' · ')

/** "Ägare, Administratör" from Better Auth's comma-separated company roles. */
export const roleText = (role: string) =>
  role
    .split(',')
    .map((r) => roleLabels[r] ?? r)
    .join(', ')
