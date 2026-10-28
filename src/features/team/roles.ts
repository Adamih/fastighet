import { m } from '#/paraglide/messages'

// Company roles and their Swedish names, for our own pages (the Team page's tables are Better
// Auth UI's, with the same names in `lib/auth/sv-se.ts`).

export const roles = ['owner', 'admin', 'member'] as const
export type Role = (typeof roles)[number]

export const roleLabels: Record<string, string> = {
  get owner() {
    return m.role_owner()
  },
  get admin() {
    return m.role_admin()
  },
  get member() {
    return m.role_member()
  },
}
