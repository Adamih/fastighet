import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  agreement,
  agreementParty,
  agreementUnit,
  ownershipTerms,
  tenant,
  type unit,
} from '#/db/schema'
import {
  joinNames,
  type OwnersProblem,
  ownershipParties,
  primaryParty,
} from '#/features/agreements/parties'
import { checkTenantsExist, checkUnitsFree, invoiceHistory } from '#/features/agreements/program'
import { agreementTerms } from '#/features/agreements/terms'
import { leaseStatus } from '#/features/leases/terms'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { sellersLastDay, type TransferProblem, transferProblem } from './rules'
import type { CreateOwnershipInput, TransferOwnershipInput, UpdateOwnershipInput } from './schemas'

// A bostadsrätt is an agreement of kind `tenant_ownership` with its `ownershipTerms` and owners.
// Seeing and managing agreements is the lease permission, whatever their kind.
const read: Permissions = { lease: ['read'] }
const manage: Permissions = { lease: ['manage'] }

const withOwnershipDetails = {
  ownershipTerms: true,
  parties: {
    orderBy: agreementParty.position,
    with: { tenant: { columns: { id: true, name: true, kind: true } } },
  },
  units: { with: { unit: { with: { property: { columns: { id: true, designation: true } } } } } },
} as const

type OwnershipRow = typeof agreement.$inferSelect & {
  ownershipTerms: typeof ownershipTerms.$inferSelect | null
  parties: (typeof agreementParty.$inferSelect & {
    tenant: { id: string; name: string; kind: 'person' | 'company' }
  })[]
  units: {
    unit: typeof unit.$inferSelect & { property: { id: string; designation: string } }
  }[]
}

const toView = ({ ownershipTerms: terms, parties, ...row }: OwnershipRow, on: string) => ({
  ...row,
  shareRatio: terms?.shareRatio ?? null,
  depositOre: terms?.depositOre ?? null,
  grantedOn: terms?.grantedOn ?? null,
  previousAgreementId: terms?.previousAgreementId ?? null,
  /** The owner named first. */
  owner: primaryParty(parties).tenant,
  ownerNames: joinNames(parties.map((p) => p.tenant.name)),
  owners: parties.map((p) => ({
    ...p.tenant,
    sharePercent: p.sharePercent ?? 0,
    receivesInvoices: p.receivesInvoices,
  })),
  units: row.units
    .map(({ unit }) => ({
      id: unit.id,
      label: unit.label,
      kind: unit.kind,
      areaSqm: unit.areaSqm,
      rooms: unit.rooms,
      propertyId: unit.property.id,
      designation: unit.property.designation,
    }))
    .sort((a, b) => a.designation.localeCompare(b.designation) || a.label.localeCompare(b.label)),
  // A bostadsrätt is active until it is transferred; `terminated` means a sale is registered.
  status: leaseStatus(agreementTerms({ ...row, leaseTerms: null }), on),
})

export type OwnershipView = ReturnType<typeof toView>

const isOwnership = (organizationId: string) =>
  and(eq(agreement.organizationId, organizationId), eq(agreement.kind, 'tenant_ownership'))

export const listOwnerships = Effect.gen(function* () {
  yield* requirePermission(read)
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findMany({
      where: isOwnership(organizationId),
      orderBy: desc(agreement.number),
      with: withOwnershipDetails,
    }),
  )
  const on = yield* today
  return rows.map((row) => toView(row, on))
})

/** The bostadsrätt with its owners' contact details, and the ones before and after a sale. */
export const getOwnership = (ownershipId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    const row = yield* orgQuery((db, organizationId) =>
      db.query.agreement.findFirst({
        where: and(eq(agreement.id, ownershipId), isOwnership(organizationId)),
        with: withOwnershipDetails,
      }),
    )
    if (!row) return yield* new NotFound({ entity: 'ownership', id: ownershipId })
    const view = toView(row, yield* today)

    const linked = yield* orgQuery((db, organizationId) =>
      db
        .select({
          id: agreement.id,
          number: agreement.number,
          startDate: agreement.startDate,
          previousAgreementId: ownershipTerms.previousAgreementId,
        })
        .from(agreement)
        .innerJoin(ownershipTerms, eq(ownershipTerms.agreementId, agreement.id))
        .where(
          and(
            eq(agreement.organizationId, organizationId),
            sql`(${agreement.id} = ${view.previousAgreementId} or ${ownershipTerms.previousAgreementId} = ${view.id})`,
          ),
        ),
    )
    const previous = linked.find((l) => l.id === view.previousAgreementId) ?? null
    const next = linked.find((l) => l.previousAgreementId === view.id) ?? null

    // Contact details are tenant data, shown only to those who may read tenants.
    const contacts = (yield* hasPermission({ tenant: ['read'] }))
      ? yield* orgQuery((db, organizationId) =>
          db.query.tenant.findMany({
            columns: { id: true, email: true, phone: true },
            where: and(
              eq(tenant.organizationId, organizationId),
              inArray(
                tenant.id,
                view.owners.map((o) => o.id),
              ),
            ),
          }),
        )
      : []
    return {
      ...view,
      owners: view.owners.map((o) => {
        const contact = contacts.find((c) => c.id === o.id)
        return { ...o, contact: contact ? { email: contact.email, phone: contact.phone } : null }
      }),
      previous: previous && { id: previous.id, number: previous.number },
      next: next && { id: next.id, number: next.number, startDate: next.startDate },
    }
  })

const ownersProblemMessages: Record<OwnersProblem, string> = {
  none: 'Välj minst en ägare',
  duplicate: 'Samma ägare är vald flera gånger',
  too_many: 'En bostadsrätt kan ha högst sex ägare',
  shares: 'Ägarandelarna ska vara hela procent och tillsammans 100 %',
  receiver: 'Välj vem som ska få avierna bland ägarna',
}

const checkOwners = (input: {
  owners: readonly { tenantId: string; sharePercent: number }[]
  invoiceRecipientId: string | null
}) =>
  Effect.gen(function* () {
    const result = ownershipParties(input.owners, input.invoiceRecipientId)
    if (!result.ok) return yield* new Conflict({ message: ownersProblemMessages[result.problem] })
    yield* checkTenantsExist(input.owners.map((o) => o.tenantId))
    return result.parties
  })

const termsValues = (input: CreateOwnershipInput) => ({
  shareRatio: input.shareRatio,
  depositOre: input.depositOre,
  grantedOn: input.grantedOn,
})

const agreementValues = (input: CreateOwnershipInput) => ({
  startDate: input.startDate,
  // The fee is monthly and carries no VAT (member fees are outside VAT).
  rentOre: input.feeOre,
  rentInterval: 'monthly' as const,
  invoiceInterval: input.invoiceInterval,
  vat: false,
})

/** The next avtalsnummer, in the same series as leases, numbered in the insert itself. */
const nextNumber = (organizationId: string) =>
  sql<number>`(select coalesce(max(${agreement.number}), 0) + 1 from ${agreement} where ${agreement.organizationId} = ${organizationId})`

export const createOwnership = (input: CreateOwnershipInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const parties = yield* checkOwners(input)
    const unitIds = yield* checkUnitsFree(input.unitIds, { start: input.startDate, end: null })
    const id = crypto.randomUUID()
    yield* orgQuery((db, organizationId) =>
      db.batch([
        db.insert(agreement).values({
          id,
          organizationId,
          number: nextNumber(organizationId),
          kind: 'tenant_ownership',
          endDate: null,
          ...agreementValues(input),
        }),
        db
          .insert(ownershipTerms)
          .values({ agreementId: id, organizationId, ...termsValues(input) }),
        db
          .insert(agreementParty)
          .values(parties.map((p) => ({ ...p, agreementId: id, organizationId }))),
        db
          .insert(agreementUnit)
          .values(unitIds.map((unitId) => ({ agreementId: id, unitId, organizationId }))),
      ]),
    )
    return { id }
  })

/**
 * Changes the owners, units, fee and details, for corrections. A sale is a transfer, which keeps
 * the sellers' bostadsrätt as history. Issued avier are not touched.
 */
export const updateOwnership = (input: UpdateOwnershipInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getOwnership(input.ownershipId)
    const history = yield* invoiceHistory(current.id)
    if (history.firstActivePeriod && input.startDate > history.firstActivePeriod) {
      return yield* new Conflict({
        message: `Bostadsrätten är aviserad från ${history.firstActivePeriod} och kan inte börja senare än så`,
      })
    }
    if (current.endDate && current.endDate < input.startDate) {
      return yield* new Conflict({
        message: `Bostadsrätten är överlåten från ${current.endDate} och kan inte börja senare än så`,
      })
    }
    const parties = yield* checkOwners(input)
    const unitIds = yield* checkUnitsFree(
      input.unitIds,
      { start: input.startDate, end: current.endDate },
      current.id,
    )
    yield* orgQuery((db, organizationId) =>
      db.batch([
        db
          .update(agreement)
          .set(agreementValues(input))
          .where(and(eq(agreement.id, current.id), eq(agreement.organizationId, organizationId))),
        db
          .update(ownershipTerms)
          .set(termsValues(input))
          .where(
            and(
              eq(ownershipTerms.agreementId, current.id),
              eq(ownershipTerms.organizationId, organizationId),
            ),
          ),
        db
          .delete(agreementParty)
          .where(
            and(
              eq(agreementParty.agreementId, current.id),
              eq(agreementParty.organizationId, organizationId),
            ),
          ),
        db
          .insert(agreementParty)
          .values(parties.map((p) => ({ ...p, agreementId: current.id, organizationId }))),
        db
          .delete(agreementUnit)
          .where(
            and(
              eq(agreementUnit.agreementId, current.id),
              eq(agreementUnit.organizationId, organizationId),
            ),
          ),
        db
          .insert(agreementUnit)
          .values(unitIds.map((unitId) => ({ agreementId: current.id, unitId, organizationId }))),
      ]),
    )
    return yield* getOwnership(current.id)
  })

const transferProblemMessages: Record<TransferProblem, string> = {
  ended: 'Bostadsrätten är redan överlåten',
  too_early: 'Tillträdesdagen måste vara efter säljarnas tillträde',
}

/**
 * A sale (överlåtelse). The sellers' bostadsrätt ends the day before `transferDate` and stays as
 * history with its avier; the buyers get a new one for the same units, fee and details, linked
 * back to it. Both happen in one batch.
 */
export const transferOwnership = (input: TransferOwnershipInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const seller = yield* getOwnership(input.ownershipId)
    const problem = transferProblem(seller, input.transferDate)
    if (problem) return yield* new Conflict({ message: transferProblemMessages[problem] })
    const parties = yield* checkOwners(input)
    const unitIds = yield* checkUnitsFree(
      seller.units.map((u) => u.id),
      { start: input.transferDate, end: null },
      seller.id,
    )
    const id = crypto.randomUUID()
    yield* orgQuery((db, organizationId) =>
      db.batch([
        db
          .update(agreement)
          .set({ endDate: sellersLastDay(input.transferDate) })
          .where(and(eq(agreement.id, seller.id), eq(agreement.organizationId, organizationId))),
        db.insert(agreement).values({
          id,
          organizationId,
          number: nextNumber(organizationId),
          kind: 'tenant_ownership',
          startDate: input.transferDate,
          endDate: null,
          rentOre: seller.rentOre,
          rentInterval: seller.rentInterval,
          invoiceInterval: seller.invoiceInterval,
          vat: false,
        }),
        db.insert(ownershipTerms).values({
          agreementId: id,
          organizationId,
          shareRatio: seller.shareRatio,
          depositOre: seller.depositOre,
          grantedOn: seller.grantedOn,
          previousAgreementId: seller.id,
        }),
        db
          .insert(agreementParty)
          .values(parties.map((p) => ({ ...p, agreementId: id, organizationId }))),
        db
          .insert(agreementUnit)
          .values(unitIds.map((unitId) => ({ agreementId: id, unitId, organizationId }))),
      ]),
    )
    return { id }
  })

/**
 * Deletes a bostadsrätt that has never been invoiced. If it came from a transfer, this undoes the
 * sale: the sellers' bostadsrätt runs on again.
 */
export const deleteOwnership = (ownershipId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const current = yield* getOwnership(ownershipId)
    const history = yield* invoiceHistory(current.id)
    if (history.total > 0) {
      return yield* new Conflict({
        message:
          'Bostadsrätten har avier och kan inte tas bort. Registrera en överlåtelse i stället.',
      })
    }
    if (current.next) {
      return yield* new Conflict({
        message: `Bostadsrätten är överlåten (bostadsrätt ${current.next.number}). Ta bort den först.`,
      })
    }
    const previous = current.previous
    yield* orgQuery((db, organizationId): Promise<unknown> => {
      const remove = db
        .delete(agreement)
        .where(and(eq(agreement.id, current.id), eq(agreement.organizationId, organizationId)))
      if (!previous) return db.batch([remove])
      return db.batch([
        remove,
        db
          .update(agreement)
          .set({ endDate: null })
          .where(
            and(
              eq(agreement.id, previous.id),
              eq(agreement.organizationId, organizationId),
              eq(agreement.endDate, sellersLastDay(current.startDate)),
            ),
          ),
      ])
    })
    return { previousId: previous?.id ?? null }
  })
