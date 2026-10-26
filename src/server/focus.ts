import { and, asc, eq, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import { managementAssignment, managementGrant, organization } from '#/db/schema'
import { cleanGrant, type Grant } from '#/lib/managed-access'
import { CompanyNotInScope } from './errors'
import { query } from './scoped'

// Which companies a request may act on. The scope is the user's own company plus every company
// that has granted their company access, if they are assigned to it or are an owner or admin at
// home. Grants don't chain: only grants to the user's own company count.

export interface Home {
  readonly id: string
  readonly name: string
  readonly role: string
}

export interface ManagedCompany {
  readonly id: string
  readonly name: string
  /** The assignment's role, or else the user's home role. */
  readonly role: string
  readonly grant: Grant
}

/** Owners and admins of the managing company reach every company it manages. */
export const seesAllClients = (homeRole: string) =>
  homeRole.split(',').some((r) => r === 'owner' || r === 'admin')

export const managedCompanies = (userId: string, home: Home) =>
  Effect.gen(function* () {
    const rows = yield* query((db) =>
      db
        .select({
          id: organization.id,
          name: organization.name,
          permissions: managementGrant.permissions,
          assigned: managementAssignment.id,
          role: managementAssignment.role,
        })
        .from(managementGrant)
        .innerJoin(organization, eq(organization.id, managementGrant.managedOrganizationId))
        .leftJoin(
          managementAssignment,
          and(
            eq(managementAssignment.managingOrganizationId, managementGrant.managingOrganizationId),
            eq(managementAssignment.managedOrganizationId, managementGrant.managedOrganizationId),
            eq(managementAssignment.userId, userId),
          ),
        )
        .where(
          and(
            eq(managementGrant.managingOrganizationId, home.id),
            isNull(managementGrant.revokedAt),
          ),
        )
        .orderBy(asc(organization.name)),
    )
    const all = seesAllClients(home.role)
    return rows
      .filter((r) => r.id !== home.id && (all || r.assigned !== null))
      .map(
        (r): ManagedCompany => ({
          id: r.id,
          name: r.name,
          role: r.role ?? home.role,
          grant: cleanGrant(safeJson(r.permissions)),
        }),
      )
  })

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The company in focus: the user's own when none (or their own) is asked for. */
export const resolveFocus = (userId: string, home: Home, requestedId: string | null) =>
  Effect.gen(function* () {
    if (requestedId === null || requestedId === home.id) return { ...home, grant: null }
    const company = (yield* managedCompanies(userId, home)).find((c) => c.id === requestedId)
    if (!company) return yield* new CompanyNotInScope()
    return company
  })
