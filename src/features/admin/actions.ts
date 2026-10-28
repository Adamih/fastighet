import { m } from '#/paraglide/messages'

// Client-safe: what the admin log records. Like the company audit log it stores keys, never
// text; the labels are messages, so the log follows the UI language.

export const adminActions = {
  impersonate: m.admin_action_impersonate,
  ban: m.admin_action_ban,
  unban: m.admin_action_unban,
  revoke_sessions: m.admin_action_revoke_sessions,
  set_role: m.admin_action_set_role,
  set_plan: m.admin_action_set_plan,
} as const

export type AdminAction = keyof typeof adminActions

export const isAdminAction = (value: string): value is AdminAction =>
  Object.hasOwn(adminActions, value)
