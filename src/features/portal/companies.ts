import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import { organization, organizationSettings, party, partyAccess } from '#/db/schema'
import { query } from '#/server/scoped'

// Which companies a person reaches in Mina sidor, and as which parties: their open
// `party_access` links. Read across companies on purpose (that is the scope itself), like
// `managedCompanies` for staff.

export interface PortalCompanyRef {
  readonly id: string
  readonly name: string
  readonly kind: 'landlord' | 'brf' | 'manager'
  readonly parties: readonly { readonly id: string; readonly name: string }[]
}

export const portalCompaniesOf = (userId: string) =>
  Effect.gen(function* () {
    const rows = yield* query((db) =>
      db
        .select({
          organizationId: organization.id,
          organizationName: organization.name,
          partyId: party.id,
          partyName: party.name,
        })
        .from(partyAccess)
        .innerJoin(organization, eq(organization.id, partyAccess.organizationId))
        // Party ids are unique, and the composite key keeps the party in the link's company.
        .innerJoin(party, eq(party.id, partyAccess.partyId))
        .where(and(eq(partyAccess.userId, userId), isNull(partyAccess.revokedAt)))
        .orderBy(asc(organization.name), asc(party.name)),
    )
    const ids = [...new Set(rows.map((r) => r.organizationId))]
    // Each company's type (landlord, brf, manager): its wording and tiers.
    const kinds =
      ids.length === 0
        ? []
        : yield* query((db) =>
            db
              .select({ id: organizationSettings.organizationId, kind: organizationSettings.kind })
              .from(organizationSettings)
              .where(inArray(organizationSettings.organizationId, ids)),
          )
    const kindOf = new Map(kinds.map((k) => [k.id, k.kind]))
    const byId = new Map<string, PortalCompanyRef & { parties: { id: string; name: string }[] }>()
    for (const r of rows) {
      const company = byId.get(r.organizationId) ?? {
        id: r.organizationId,
        name: r.organizationName,
        kind: kindOf.get(r.organizationId) ?? 'landlord',
        parties: [],
      }
      company.parties.push({ id: r.partyId, name: r.partyName })
      byId.set(r.organizationId, company)
    }
    return [...byId.values()] as PortalCompanyRef[]
  })
