import { type AssignmentRole, assignmentRoles, type Permissions, roles } from './permissions'

// What a manager's staff may do in a company they manage. Pure and client-safe: the server
// checks with it (`requirePermission`) and the UI mirrors it (`useCan`).
//
// Three layers: the managed company's grant (raw permissions, the most anyone from the manager
// may ever do there), the manager's assignment of staff to the company, and the person's role
// (the assignment's, or else their home role). Allowed = the role allows it AND the grant does.

/** Resources a company can let another company manage. Never the team, invitations or grants. */
export const grantableResources = [
  'property',
  'tenant',
  'lease',
  'invoice',
  'payment',
  'settings',
  'bookkeeping',
] as const
export type GrantableResource = (typeof grantableResources)[number]

export const accessLevels = ['none', 'read', 'manage'] as const
export type AccessLevel = (typeof accessLevels)[number]
export type GrantLevels = Record<GrantableResource, AccessLevel>

/** A grant as stored: only grantable resources, and `manage` always with `read`. */
export type Grant = { [K in GrantableResource]?: ('read' | 'manage')[] }

export function grantFromLevels(levels: Partial<GrantLevels>): Grant {
  const grant: Grant = {}
  for (const resource of grantableResources) {
    const level = levels[resource] ?? 'none'
    if (level === 'read') grant[resource] = ['read']
    if (level === 'manage') grant[resource] = ['read', 'manage']
  }
  return grant
}

export const levelsFromGrant = (grant: Grant): GrantLevels =>
  Object.fromEntries(
    grantableResources.map((r) => [
      r,
      grant[r]?.includes('manage') ? 'manage' : grant[r]?.includes('read') ? 'read' : 'none',
    ]),
  ) as GrantLevels

/**
 * Keeps only what can be granted, whatever was stored or sent. Unknown resources and actions,
 * and Better Auth's own statements, are dropped; `manage` brings `read`.
 */
export function cleanGrant(input: unknown): Grant {
  if (!input || typeof input !== 'object') return {}
  const levels: Partial<GrantLevels> = {}
  for (const resource of grantableResources) {
    const actions = (input as Record<string, unknown>)[resource]
    if (!Array.isArray(actions)) continue
    levels[resource] = actions.includes('manage')
      ? 'manage'
      : actions.includes('read')
        ? 'read'
        : 'none'
  }
  return grantFromLevels(levels)
}

export const isEmptyGrant = (grant: Grant) => Object.keys(cleanGrant(grant)).length === 0

export const grantPresets = {
  full: grantFromLevels(Object.fromEntries(grantableResources.map((r) => [r, 'manage']))),
  finance: grantFromLevels({
    property: 'read',
    tenant: 'read',
    lease: 'read',
    invoice: 'manage',
    payment: 'manage',
    settings: 'read',
    bookkeeping: 'manage',
  }),
  readOnly: grantFromLevels(Object.fromEntries(grantableResources.map((r) => [r, 'read']))),
} as const satisfies Record<string, Grant>
export type GrantPreset = keyof typeof grantPresets

/** The preset a grant matches exactly, if any. */
export function presetOf(grant: Grant): GrantPreset | null {
  const levels = levelsFromGrant(grant)
  for (const [name, preset] of Object.entries(grantPresets)) {
    const p = levelsFromGrant(preset)
    if (grantableResources.every((r) => p[r] === levels[r])) return name as GrantPreset
  }
  return null
}

const allRoles: Record<string, { authorize: (request: never) => { success: boolean } }> = {
  ...roles,
  ...assignmentRoles,
}

export const isAssignmentRole = (role: string): role is AssignmentRole =>
  Object.hasOwn(assignmentRoles, role)

/**
 * Whether `roleName` (comma-separated like Better Auth's, any role is enough) allows `wanted`,
 * and the grant includes every permission in it.
 */
export function managedAllows(roleName: string, grant: Grant, wanted: Permissions): boolean {
  const allowed = cleanGrant(grant) as Record<string, string[] | undefined>
  const inGrant = Object.entries(wanted).every(
    ([resource, actions]) =>
      (actions ?? []).length > 0 &&
      (actions ?? []).every((a) => allowed[resource]?.includes(a) ?? false),
  )
  if (!inGrant) return false
  return roleName
    .split(',')
    .map((r) => r.trim())
    .filter((r) => Object.hasOwn(allRoles, r))
    .map((r) => allRoles[r])
    .some((role) => role.authorize(wanted as never).success)
}
