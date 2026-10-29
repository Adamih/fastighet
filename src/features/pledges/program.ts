import { eq, inArray, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Db } from '#/db'
import { agreement, charge, pledge } from '#/db/schema'
import { feeCharge } from '#/features/ownerships/fee-program'
import { loadFeeTerms } from '#/features/settings/program'
import { formatOrganizationNumber } from '#/features/tenants/organization-number'
import type { Permissions } from '#/lib/permissions'
import { blankToNull } from '#/lib/schemas'
import { requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { inCompany, orgQuery, query } from '#/server/scoped'
import { CurrentOrganization, CurrentUser } from '#/server/services'
import { today } from '#/server/today'
import {
  activeOn,
  inPriorityOrder,
  type RegisterProblem,
  type ReleaseProblem,
  registerProblem,
  releaseProblem,
} from './rules'
import type { RegisterPledgeInput, ReleasePledgeInput } from './schemas'

// Pledges (pantsättningar) of bostadsrätter for the apartment register. Like the bostadsrätter
// themselves they use the lease permissions. Pledges are never deleted: a release closes one.

const manage: Permissions = { lease: ['manage'] }

const columns = {
  id: pledge.id,
  agreementId: pledge.agreementId,
  creditorName: pledge.creditorName,
  creditorOrganizationNumber: pledge.creditorOrganizationNumber,
  reference: pledge.reference,
  notifiedOn: pledge.notifiedOn,
  note: pledge.note,
  createdAt: pledge.createdAt,
  releasedOn: pledge.releasedOn,
  releaseNote: pledge.releaseNote,
  confirmationEmail: pledge.confirmationEmail,
  confirmedAt: pledge.confirmedAt,
  releaseConfirmedAt: pledge.releaseConfirmedAt,
}

/**
 * The pledges of the given bostadsrätter, in priority order per bostadsrätt, as the register
 * stood on `asOf` (today by default): later notices are left out and releases after it don't
 * count yet. Callers check read access (the bostadsrätt's own).
 */
export const pledgesIn = Effect.fn('pledges.pledgesIn')(function* (
  organizationId: string,
  agreementIds: readonly string[],
  asOf?: string,
) {
  if (agreementIds.length === 0) return new Map<string, PledgeView[]>()
  const rows = yield* query((db) =>
    db
      .select(columns)
      .from(pledge)
      .where(inCompany(pledge, organizationId, inArray(pledge.agreementId, [...agreementIds]))),
  )
  const on = asOf ?? (yield* today)
  const byAgreement = new Map<string, PledgeView[]>()
  for (const id of agreementIds) {
    const own = rows
      .filter((r) => r.agreementId === id && r.notifiedOn <= on)
      .map((r) => ({
        ...r,
        createdAt: r.createdAt.getTime(),
        confirmedAt: r.confirmedAt?.getTime() ?? null,
        releaseConfirmedAt: r.releaseConfirmedAt?.getTime() ?? null,
        // A release after `asOf` hadn't happened yet.
        ...(r.releasedOn && r.releasedOn > on ? { releasedOn: null, releaseNote: null } : {}),
      }))
    byAgreement.set(id, inPriorityOrder(own, on))
  }
  return byAgreement
})

/** Pledges in the company in focus (see `pledgesIn`). */
export const pledgesFor = (agreementIds: readonly string[], asOf?: string) =>
  Effect.gen(function* () {
    return yield* pledgesIn((yield* CurrentOrganization).id, agreementIds, asOf)
  })

type PledgeRow = Omit<
  typeof pledge.$inferSelect,
  | 'createdAt'
  | 'confirmedAt'
  | 'releaseConfirmedAt'
  | 'organizationId'
  | 'registeredBy'
  | 'releasedBy'
> & { createdAt: number; confirmedAt: number | null; releaseConfirmedAt: number | null }

/** A pledge for display: `priority` numbers the active ones from 1, null once released. */
export type PledgeView = PledgeRow & { active: boolean; priority: number | null }

/** How many pledges are in force on each bostadsrätt today, for lists. */
export const activePledgeCounts = Effect.fn('pledges.activePledgeCounts')(function* (
  agreementIds: readonly string[],
) {
  const pledges = yield* pledgesFor(agreementIds)
  return new Map([...pledges].map(([id, list]) => [id, list.filter((p) => p.active).length]))
})

const registerProblemMessages: Record<RegisterProblem, string> = {
  future: 'Datumet då underrättelsen kom in kan inte vara i framtiden',
  ended: 'Bostadsrätten var redan överlåten då underrättelsen kom in',
}

const releaseProblemMessages: Record<ReleaseProblem, string> = {
  released: 'Pantsättningen är redan avregistrerad',
  before_notice: 'Avregistreringen kan inte vara före underrättelsen om pantsättningen',
  future: 'Avregistreringen kan inte vara i framtiden',
}

/**
 * Registers a lender's notice on a bostadsrätt, with the förening's pantsättningsavgift as a
 * one-off amount on it when it charges one (unless the board skips it), in the same batch.
 */
export const registerPledge = Effect.fn('pledges.registerPledge')(function* (
  input: RegisterPledgeInput,
) {
  yield* requirePermission(manage)
  const me = yield* CurrentUser
  const [ownership] = yield* orgQuery((db, organizationId) =>
    db
      .select({ id: agreement.id, startDate: agreement.startDate, endDate: agreement.endDate })
      .from(agreement)
      .where(
        inCompany(
          agreement,
          organizationId,
          eq(agreement.id, input.ownershipId),
          eq(agreement.kind, 'tenant_ownership'),
        ),
      ),
  )
  if (!ownership) return yield* new NotFound({ entity: 'ownership', id: input.ownershipId })
  const problem = registerProblem(ownership, input.notifiedOn, yield* today)
  if (problem) return yield* new Conflict({ message: registerProblemMessages[problem] })
  const creditorName = input.creditorName.trim()
  const fee = yield* feeCharge('pledge_fee', yield* loadFeeTerms, {
    charge: input.chargeFee ?? false,
    date: input.notifiedOn,
    agreement: ownership,
    description: `Pantsättningsavgift, ${creditorName}`,
  })
  const orgNumber = blankToNull(input.creditorOrganizationNumber)
  const id = crypto.randomUUID()
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db.insert(pledge).values({
        id,
        organizationId,
        agreementId: ownership.id,
        creditorName,
        creditorOrganizationNumber: orgNumber && formatOrganizationNumber(orgNumber),
        reference: blankToNull(input.reference),
        notifiedOn: input.notifiedOn,
        note: blankToNull(input.note),
        registeredBy: me.id,
        confirmationEmail: blankToNull(input.confirmationEmail ?? ''),
      }),
      ...(fee ? [db.insert(charge).values({ ...fee, organizationId })] : []),
    ]),
  )
  return { id, ownershipId: ownership.id, feeOre: fee?.amountOre ?? null }
})

/**
 * The statements that release pledges, guarded so a pledge already released is left alone (the
 * caller has checked; this keeps a concurrent release from being overwritten).
 */
export const releaseStatements = (
  db: Db,
  organizationId: string,
  pledgeIds: readonly string[],
  release: { releasedOn: string; note: string | null; userId: string },
) =>
  pledgeIds.map((id) =>
    db
      .update(pledge)
      .set({
        releasedOn: release.releasedOn,
        releaseNote: release.note,
        releasedBy: release.userId,
      })
      .where(inCompany(pledge, organizationId, eq(pledge.id, id), isNull(pledge.releasedOn))),
  )

/** Registers that a pledge no longer applies, at the lender's request or to correct a mistake. */
export const releasePledge = Effect.fn('pledges.releasePledge')(function* (
  input: ReleasePledgeInput,
) {
  yield* requirePermission(manage)
  const me = yield* CurrentUser
  const [found] = yield* orgQuery((db, organizationId) =>
    db
      .select({
        id: pledge.id,
        agreementId: pledge.agreementId,
        notifiedOn: pledge.notifiedOn,
        releasedOn: pledge.releasedOn,
      })
      .from(pledge)
      .where(inCompany(pledge, organizationId, eq(pledge.id, input.pledgeId))),
  )
  if (!found) return yield* new NotFound({ entity: 'pledge', id: input.pledgeId })
  const problem = releaseProblem(found, input.releasedOn, yield* today)
  if (problem) return yield* new Conflict({ message: releaseProblemMessages[problem] })
  yield* orgQuery((db, organizationId) =>
    db.batch(
      releaseStatements(db, organizationId, [found.id], {
        releasedOn: input.releasedOn,
        note: blankToNull(input.note),
        userId: me.id,
      }) as [ReturnType<typeof releaseStatements>[number]],
    ),
  )
  return { id: found.id, ownershipId: found.agreementId }
})

/** The seller's pledges in force on `date`, for the sale warning and its releases. */
export const activePledgesOf = (agreementId: string, date: string) =>
  pledgesFor([agreementId]).pipe(
    Effect.map((byAgreement) =>
      (byAgreement.get(agreementId) ?? []).filter((p) => activeOn(p, date)),
    ),
  )
