import { and, eq, like, or } from 'drizzle-orm'
import type { Db } from '#/db'
import { managementAssignment, member, organizationRole, organizationSettings } from '#/db/schema'
import { tierOf } from '#/features/billing/store'
import { cheapestTierFor, tierAllows, tiers } from '#/features/billing/tiers'
import { type AppPermissions, appPermissions, reservedRoleNames } from '#/lib/permissions'

// Our rules for custom roles (Better Auth's dynamic access control), checked before its role
// endpoints run (`hooks` in `lib/auth-config.ts`). Better Auth already checks that the caller may
// manage roles, grants nothing they lack, keeps names unique and refuses deleting a role members
// hold. On top: only app resources, `manage` with `read`, a tier that includes custom roles, names
// that fit our role lists, and no rename or delete of a role our own records use. Plain async
// functions taking the database, so the Better Auth CLI can still load the config.

/** A role name as Better Auth stores it. */
export const roleKey = (name: string) => name.toLowerCase()

/** Why a role name can't be used, or null. */
export function roleNameProblem(name: string): string | null {
  const key = roleKey(name)
  if (!key.trim() || key !== key.trim()) return 'Ange ett namn utan mellanslag först eller sist.'
  // Better Auth keeps several roles in one field, separated by commas.
  if (key.includes(',')) return 'Ett rollnamn kan inte innehålla kommatecken.'
  if (reservedRoleNames.includes(key)) return 'Namnet används redan av en inbyggd roll.'
  return null
}

const permissionProblem =
  'En egen roll kan bara ge behörighet till fastigheter, hyresgäster, avtal, avier, betalningar, företagsuppgifter och bokföring.'

/** Whether members or assignments use a role, for refusing a rename or delete. */
async function roleInUse(db: Db, organizationId: string, key: string) {
  const [held] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        or(
          eq(member.role, key),
          like(member.role, `${key},%`),
          like(member.role, `%,${key}`),
          like(member.role, `%,${key},%`),
        ),
      ),
    )
    .limit(1)
  if (held) return 'members'
  const [assigned] = await db
    .select({ id: managementAssignment.id })
    .from(managementAssignment)
    .where(
      and(
        eq(managementAssignment.managingOrganizationId, organizationId),
        eq(managementAssignment.role, key),
      ),
    )
    .limit(1)
  return assigned ? 'assignments' : null
}

async function tierProblem(db: Db, organizationId: string) {
  const tier = await tierOf(db, organizationId)
  if (tierAllows(tier, 'roles')) return null
  const [settings] = await db
    .select({ kind: organizationSettings.kind })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, organizationId))
  const needed = cheapestTierFor(settings?.kind ?? 'landlord', 'roles')
  return needed
    ? `Egna roller ingår inte i ${tiers[tier].name()}. De finns i ${needed.name()} och uppåt (Abonnemang).`
    : 'Egna roller finns inte för den här typen av företag.'
}

/** The role a request names, by id or name, as stored. */
async function storedRole(
  db: Db,
  organizationId: string,
  by: { roleId?: unknown; roleName?: unknown },
) {
  const condition =
    typeof by.roleId === 'string'
      ? eq(organizationRole.id, by.roleId)
      : typeof by.roleName === 'string'
        ? eq(organizationRole.role, roleKey(by.roleName))
        : null
  if (!condition) return null
  const [row] = await db
    .select({ role: organizationRole.role })
    .from(organizationRole)
    .where(and(eq(organizationRole.organizationId, organizationId), condition))
  return row ?? null
}

export type RoleCheck =
  | { readonly problem: string }
  /** Allowed; `permission` is what to store instead of what was sent (`manage` with `read`). */
  | { readonly problem: null; readonly permission?: AppPermissions }

/**
 * Checks a request to Better Auth's role endpoints against our rules. `path` is the endpoint,
 * `body` what was sent.
 */
export async function checkRoleRequest(
  db: Db,
  organizationId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<RoleCheck> {
  if (path === '/organization/create-role') {
    const tier = await tierProblem(db, organizationId)
    if (tier) return { problem: tier }
    const name = roleNameProblem(String(body.role ?? ''))
    if (name) return { problem: name }
    const permission = appPermissions(body.permission)
    if (!permission) return { problem: permissionProblem }
    if (Object.keys(permission).length === 0) {
      return { problem: 'Välj minst en behörighet för rollen.' }
    }
    return { problem: null, permission }
  }
  if (path === '/organization/update-role') {
    const tier = await tierProblem(db, organizationId)
    if (tier) return { problem: tier }
    const data = (body.data ?? {}) as Record<string, unknown>
    const current = await storedRole(db, organizationId, body)
    if (typeof data.roleName === 'string' && current && roleKey(data.roleName) !== current.role) {
      const name = roleNameProblem(data.roleName)
      if (name) return { problem: name }
      // Better Auth renames the role but not what refers to it, which would then allow nothing.
      if (await roleInUse(db, organizationId, current.role)) {
        return {
          problem:
            'Rollen används och kan inte byta namn. Skapa en ny roll och flytta över till den.',
        }
      }
    }
    if (data.permission === undefined) return { problem: null }
    const permission = appPermissions(data.permission)
    if (!permission) return { problem: permissionProblem }
    if (Object.keys(permission).length === 0) {
      return { problem: 'Välj minst en behörighet för rollen.' }
    }
    return { problem: null, permission }
  }
  if (path === '/organization/delete-role') {
    const current = await storedRole(db, organizationId, body)
    // Better Auth refuses roles members hold; our assignments are ours to check.
    if (current && (await roleInUse(db, organizationId, current.role)) === 'assignments') {
      return {
        problem: 'Rollen används för personal hos kundbolag. Byt deras roll under Kundbolag först.',
      }
    }
  }
  return { problem: null }
}

/** Better Auth's role endpoints, which `checkRoleRequest` covers. */
export const roleEndpoints: ReadonlySet<string> = new Set([
  '/organization/create-role',
  '/organization/update-role',
  '/organization/delete-role',
])
