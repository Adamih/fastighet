import { createAccessControl } from 'better-auth/plugins/access'
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access'

// Role-based access control, shared by Better Auth (organization plugin), the server
// permission API and client checkRolePermission helper. Client-safe: no server imports.
//
// Every app resource has two permissions: `read` (view it) and `manage` (create, edit and delete
// it). `manage` does not imply `read`; every role that manages something is also given read.
// Better Auth's own statements (organization, member, invitation, team, ac) are kept as they are.

export const statement = {
  ...defaultStatements,
  /** Properties and their units. */
  property: ['read', 'manage'],
  tenant: ['read', 'manage'],
  lease: ['read', 'manage'],
  invoice: ['read', 'manage'],
  payment: ['read', 'manage'],
  /** Company settings printed on invoices (bankgiro, address, …). */
  settings: ['read', 'manage'],
  /** The SIE export (`read`) and the company's account numbers (`manage`). */
  bookkeeping: ['read', 'manage'],
  /** Companies this company manages ("Kundbolag"): requests for access and staff assignments. */
  client: ['read', 'manage'],
  /** Companies that manage this company ("Förvaltare"): approving, changing and revoking grants. */
  grant: ['read', 'manage'],
} as const

export const ac = createAccessControl(statement)

const full = ['read', 'manage'] as const
const readOnly = ['read'] as const

const appFull = {
  property: full,
  tenant: full,
  lease: full,
  invoice: full,
  payment: full,
  settings: full,
  bookkeeping: full,
}

/**
 * Only the owner decides who else may manage the company. Better Auth's owner may also delete the
 * company; ours may not (the endpoint is disabled too), since that would erase its accounting
 * records.
 */
export const owner = ac.newRole({
  ...ownerAc.statements,
  organization: ['update'],
  ...appFull,
  client: full,
  grant: full,
})
export const admin = ac.newRole({
  ...adminAc.statements,
  ...appFull,
  client: full,
  grant: readOnly,
})
/**
 * Runs the day-to-day work; cannot change company settings, manage the team, or export the books.
 */
const { bookkeeping: _, ...memberApp } = appFull
export const member = ac.newRole({
  ...memberAc.statements,
  ...memberApp,
  settings: readOnly,
  client: readOnly,
})

/** Better Auth's roles: what a member of a company may do there. */
export const roles = { owner, admin, member }

/**
 * Read only. Not a Better Auth role (nobody is invited as one); a managing company can give it
 * to staff on one assignment, e.g. to stand in at a client without changing anything.
 */
export const viewer = ac.newRole({
  property: readOnly,
  tenant: readOnly,
  lease: readOnly,
  invoice: readOnly,
  payment: readOnly,
  settings: readOnly,
  bookkeeping: readOnly,
})

/** Roles an assignment to a managed company can set; without one, the home role applies. */
export const assignmentRoles = { admin, member, viewer }
export type AssignmentRole = keyof typeof assignmentRoles

type Statement = typeof statement
export type Permissions = { [K in keyof Statement]?: Statement[K][number][] }

// Custom roles (Better Auth's dynamic access control). A company's owners and admins create them
// on the Team page; members hold them like the built-in roles, and a managing company can set one
// on an assignment. They cover the app's resources only: the team, invitations, roles, Kundbolag
// and Förvaltare stay with owners and admins.

/** What a custom role (and a grant to a managing company) can include. */
export const appResources = [
  'property',
  'tenant',
  'lease',
  'invoice',
  'payment',
  'settings',
  'bookkeeping',
] as const
export type AppResource = (typeof appResources)[number]
export type AppPermissions = { [K in AppResource]?: ('read' | 'manage')[] }

/** Names a custom role can't take: the built-in roles, assignment roles included. */
export const reservedRoleNames: readonly string[] = [
  ...new Set([...Object.keys(roles), ...Object.keys(assignmentRoles)]),
]

/**
 * A custom role's permissions as stored, or as sent: only app resources and their actions, and
 * `manage` always with `read`. Null when anything else is in it, so it can be refused.
 */
export function appPermissions(input: unknown): AppPermissions | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const result: AppPermissions = {}
  for (const [resource, actions] of Object.entries(input)) {
    if (!(appResources as readonly string[]).includes(resource)) return null
    if (!Array.isArray(actions) || actions.some((a) => a !== 'read' && a !== 'manage')) return null
    if (actions.length === 0) continue
    result[resource as AppResource] = actions.includes('manage') ? ['read', 'manage'] : ['read']
  }
  return result
}

/** A company's custom roles by name, with their permissions. */
export type CustomRoles = Readonly<Record<string, AppPermissions>>

const builtInRoles: Record<string, { authorize: (request: never) => { success: boolean } }> = {
  ...roles,
  ...assignmentRoles,
}

/**
 * Whether `roleName` (comma-separated like Better Auth's, any role is enough) allows `wanted`:
 * a built-in role by its statements, a custom role by its stored permissions.
 */
export function roleAllows(roleName: string, wanted: Permissions, customRoles: CustomRoles) {
  const asked = Object.entries(wanted)
  if (asked.length === 0 || asked.some(([, actions]) => (actions ?? []).length === 0)) return false
  return roleName
    .split(',')
    .map((r) => r.trim())
    .some((r) => {
      if (Object.hasOwn(builtInRoles, r)) {
        return builtInRoles[r].authorize(wanted as never).success
      }
      const custom = Object.hasOwn(customRoles, r) ? customRoles[r] : undefined
      return (
        custom !== undefined &&
        asked.every(([resource, actions]) =>
          (actions ?? []).every((a) =>
            (custom[resource as AppResource] as string[] | undefined)?.includes(a),
          ),
        )
      )
    })
}
