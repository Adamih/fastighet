import { Effect } from 'effect'
import { PortalCompany } from '#/server/services'

// Test helper: runs a portal program as a person whose parties in the harness company ('org')
// are `partyIds`, like `runPortal` would.

export const asPortal =
  (partyIds: string[], tier: 'landlord_pro' | 'landlord_free' = 'landlord_pro') =>
  <A, E, R>(program: Effect.Effect<A, E, R>) =>
    program.pipe(
      Effect.provideService(PortalCompany, {
        id: 'org',
        name: 'Test',
        kind: 'landlord',
        tier,
        parties: partyIds.map((id) => ({ id, name: id })),
        partyIds,
      }),
    )
