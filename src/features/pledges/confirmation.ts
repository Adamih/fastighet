import { eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { pledge } from '#/db/schema'
import { registerEntry } from '#/features/ownerships/program'
import { loadCompanyDetails } from '#/features/settings/program'
import { maxDate, minDate } from '#/lib/dates'
import type { Permissions } from '#/lib/permissions'
import { blankToNull } from '#/lib/schemas'
import { requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { sendEmail } from '#/server/mail/mailer'
import { inCompany, orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { type ConfirmationDocument, confirmationText } from './confirmation-text'
import { pledgesFor, registerPledge } from './program'
import type {
  ConfirmationKind,
  ConfirmPledgeInput,
  PledgeConfirmationInput,
  RegisterPledgeInput,
} from './schemas'

// The förening's written confirmation to a lender (bekräftelse) that its pledge was registered,
// or released. It goes by email, or is printed and posted; either way the pledge records that it
// was sent (`confirmedAt`, `releaseConfirmedAt`). Lease permissions apply, as for pledges.

/**
 * The confirmation as it reads today, with whether and where it has been sent. The holders and
 * priority are those of today, within the bostadsrätt's own period.
 */
export const pledgeConfirmation = Effect.fn('pledges.pledgeConfirmation')(function* (
  input: PledgeConfirmationInput,
) {
  yield* requirePermission({ lease: ['read'] })
  const [found] = yield* orgQuery((db, organizationId) =>
    db
      .select({ id: pledge.id, agreementId: pledge.agreementId })
      .from(pledge)
      .where(inCompany(pledge, organizationId, eq(pledge.id, input.pledgeId))),
  )
  if (!found) return yield* new NotFound({ entity: 'pledge', id: input.pledgeId })
  const on = yield* today
  const entry = yield* registerEntry(found.agreementId, (row) =>
    minDate(maxDate(on, row.startDate), row.endDate ?? on),
  )
  const own = (yield* pledgesFor([found.agreementId])).get(found.agreementId) ?? []
  const p = own.find((x) => x.id === found.id)
  if (!p) return yield* new NotFound({ entity: 'pledge', id: input.pledgeId })
  if (input.kind === 'released' && !p.releasedOn) {
    return yield* new Conflict({ message: 'Pantsättningen är inte avregistrerad' })
  }
  const seller = yield* loadCompanyDetails
  const a = entry.apartment
  const document: ConfirmationDocument = {
    kind: input.kind,
    writtenOn: on,
    association: {
      name: seller.organizationName,
      organizationNumber: seller.organizationNumber,
      streetAddress: seller.streetAddress,
      postalCode: seller.postalCode,
      city: seller.city,
      email: seller.email,
      phone: seller.phone,
    },
    ownership: { number: entry.ownership.number },
    apartment: a && {
      label: a.label,
      designation: a.designation,
      address:
        [a.streetAddress, [a.postalCode, a.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ') || null,
    },
    holders: entry.holders,
    pledge: {
      creditorName: p.creditorName,
      creditorOrganizationNumber: p.creditorOrganizationNumber,
      reference: p.reference,
      notifiedOn: p.notifiedOn,
      releasedOn: p.releasedOn,
      priority: p.priority,
    },
  }
  return {
    pledgeId: p.id,
    ownershipId: found.agreementId,
    kind: input.kind,
    text: confirmationText(document),
    /** Where the lender asked for confirmations, if they did. */
    email: p.confirmationEmail,
    /** Replies from the lender go to the förening. */
    replyTo: seller.email,
    /** When this confirmation was sent, if it was. */
    sentAt: input.kind === 'registered' ? p.confirmedAt : p.releaseConfirmedAt,
  }
})

const manage: Permissions = { lease: ['manage'] }

const sentColumn = (kind: ConfirmationKind) =>
  kind === 'registered' ? 'confirmedAt' : 'releaseConfirmedAt'

/**
 * Sends the confirmation to `email` and records it as sent; with a blank email, only records that
 * it went by post. The address is kept on the pledge for its next confirmation.
 */
export const confirmPledge = Effect.fn('pledges.confirmPledge')(function* (
  input: ConfirmPledgeInput,
) {
  yield* requirePermission(manage)
  const confirmation = yield* pledgeConfirmation(input)
  const email = blankToNull(input.email)
  if (email) {
    yield* sendEmail({
      to: email,
      replyTo: confirmation.replyTo ?? undefined,
      template: 'pledgeConfirmation',
      props: { ...confirmation.text, canReply: confirmation.replyTo !== null },
    })
  }
  const sentAt = new Date(yield* Clock.currentTimeMillis)
  yield* orgQuery((db, organizationId) =>
    db
      .update(pledge)
      .set({
        [sentColumn(input.kind)]: sentAt,
        ...(email ? { confirmationEmail: email } : {}),
      })
      .where(inCompany(pledge, organizationId, eq(pledge.id, confirmation.pledgeId))),
  )
  return { id: confirmation.pledgeId, ownershipId: confirmation.ownershipId, emailed: email }
})

/**
 * Registers a pledge and, when the lender gave an address, emails it the confirmation. A failed
 * email doesn't undo the registration: the pledge then shows as not yet confirmed.
 */
export const registerAndConfirm = Effect.fn('pledges.registerAndConfirm')(function* (
  input: RegisterPledgeInput,
) {
  const created = yield* registerPledge(input)
  const email = blankToNull(input.confirmationEmail ?? '')
  if (!email) return { ...created, confirmed: false }
  const confirmed = yield* confirmPledge({
    pledgeId: created.id,
    kind: 'registered',
    email,
  }).pipe(
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.logError('Pledge confirmation failed', cause).pipe(Effect.as(false)),
    ),
  )
  return { ...created, confirmed }
})
