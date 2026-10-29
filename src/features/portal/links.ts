import { eq, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import { partyAccess } from '#/db/schema'
import { inCompany, orgQuery } from '#/server/scoped'
import { AppUrl, CurrentOrganization } from '#/server/services'

/**
 * A link into Mina sidor for an email to a party (e.g. the avi page), when someone has portal
 * access to the party and the app's address is known; null otherwise, and the email leaves it out.
 */
export const portalLink = (partyId: string, path: `/portal/${string}`) =>
  Effect.gen(function* () {
    const { origin } = yield* AppUrl
    if (!origin) return null
    const [access] = yield* orgQuery((db, organizationId) =>
      db
        .select({ id: partyAccess.id })
        .from(partyAccess)
        .where(
          inCompany(
            partyAccess,
            organizationId,
            eq(partyAccess.partyId, partyId),
            isNull(partyAccess.revokedAt),
          ),
        )
        .limit(1),
    )
    if (!access) return null
    const company = yield* CurrentOrganization
    return `${origin}${path}?company=${encodeURIComponent(company.id)}`
  })
