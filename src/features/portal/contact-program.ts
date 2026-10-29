import { eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import { organizationSettings, party } from '#/db/schema'
import { blankToNull } from '#/lib/schemas'
import { Conflict } from '#/server/errors'
import { inCompany, portalQuery } from '#/server/scoped'
import { PortalCompany, PortalUser } from '#/server/services'
import type { UpdatePortalContactInput } from './schemas'

// "Mina uppgifter": the contact details of the person's parties, which they may change when the
// company allows it, and whom to contact at the company. Issued avier keep their own copies;
// the next avi uses the new details.

const companySettings = portalQuery((db, scope) =>
  db
    .select({
      email: organizationSettings.email,
      phone: organizationSettings.phone,
      portalContactEdits: organizationSettings.portalContactEdits,
      portalContactEmail: organizationSettings.portalContactEmail,
      portalContactPhone: organizationSettings.portalContactPhone,
    })
    .from(organizationSettings)
    .where(inCompany(organizationSettings, scope.organizationId)),
).pipe(Effect.map(([row]) => row))

/** The person's parties in the company in focus, with their contact details. */
const ownParties = portalQuery((db, scope) =>
  db
    .select({
      id: party.id,
      name: party.name,
      kind: party.kind,
      email: party.email,
      phone: party.phone,
      streetAddress: party.streetAddress,
      postalCode: party.postalCode,
      city: party.city,
    })
    .from(party)
    .where(inCompany(party, scope.organizationId, inArray(party.id, [...scope.partyIds])))
    .orderBy(party.name),
)

export const portalContact = Effect.gen(function* () {
  const company = yield* PortalCompany
  const settings = yield* companySettings
  return {
    company: {
      name: company.name,
      email: settings?.portalContactEmail ?? settings?.email ?? null,
      phone: settings?.portalContactPhone ?? settings?.phone ?? null,
    },
    editsAllowed: settings?.portalContactEdits ?? true,
    loginEmail: (yield* PortalUser).email,
    parties: yield* ownParties,
  }
}).pipe(Effect.withSpan('portal.portalContact'))

export type PortalContact = Effect.Success<typeof portalContact>

/** Changes one of the person's parties' contact details, when the company allows it. */
export const updatePortalContact = Effect.fn('portal.updatePortalContact')(function* (
  input: UpdatePortalContactInput,
) {
  const company = yield* PortalCompany
  if (!company.partyIds.includes(input.partyId)) {
    return yield* new Conflict({ message: 'Du kan bara ändra dina egna uppgifter.' })
  }
  if (!((yield* companySettings)?.portalContactEdits ?? true)) {
    return yield* new Conflict({
      message: `${company.name} tar emot ändringar av kontaktuppgifter själva. Kontakta dem.`,
    })
  }
  yield* portalQuery((db, scope) =>
    db
      .update(party)
      .set({
        email: blankToNull(input.email),
        phone: blankToNull(input.phone),
        streetAddress: blankToNull(input.streetAddress),
        postalCode: blankToNull(input.postalCode.replace(/\s/g, '')),
        city: blankToNull(input.city),
      })
      .where(inCompany(party, scope.organizationId, eq(party.id, input.partyId))),
  )
  return yield* portalContact
})
