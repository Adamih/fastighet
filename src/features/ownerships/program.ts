import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import type { Db } from '#/db'
import {
  agreement,
  agreementParty,
  agreementUnit,
  brfApartment,
  charge,
  ownershipTerms,
  party,
  type unit,
  unit as unitTable,
} from '#/db/schema'
import { currentTerms, shownRows } from '#/features/agreements/current'
import {
  joinNames,
  type OwnersProblem,
  ownershipParties,
  primaryParty,
} from '#/features/agreements/parties'
import { inForceOn } from '#/features/agreements/periods'
import {
  billedOnceChargeIds,
  checkPartiesExist,
  checkUnitsFree,
  correctBaseCharge,
  correctOpenTerms,
  invoiceHistory,
} from '#/features/agreements/program'
import { agreementTerms } from '#/features/agreements/terms'
import { leaseStatus } from '#/features/leases/terms'
import {
  activePledgeCounts,
  activePledgesOf,
  pledgesFor,
  releaseStatements,
} from '#/features/pledges/program'
import { loadCompanyDetails, loadFeeTerms } from '#/features/settings/program'
import { stockholmDate } from '#/lib/dates'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { inCompany, orgQuery, orNotFound, query } from '#/server/scoped'
import { CurrentOrganization, CurrentUser, HomeOrganization } from '#/server/services'
import { today } from '#/server/today'
import { feeCharge } from './fee-program'
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
    with: { party: { columns: { id: true, name: true, kind: true } } },
  },
  units: {
    with: {
      unit: {
        with: {
          property: {
            columns: {
              id: true,
              designation: true,
              streetAddress: true,
              postalCode: true,
              city: true,
            },
          },
          brfApartment: true,
        },
      },
    },
  },
  charges: true,
} as const

type OwnershipRow = typeof agreement.$inferSelect & {
  ownershipTerms: typeof ownershipTerms.$inferSelect | null
  charges: (typeof charge.$inferSelect)[]
  parties: (typeof agreementParty.$inferSelect & {
    party: { id: string; name: string; kind: 'person' | 'company' }
  })[]
  units: (typeof agreementUnit.$inferSelect & {
    unit: typeof unit.$inferSelect & {
      property: {
        id: string
        designation: string
        streetAddress: string | null
        postalCode: string | null
        city: string | null
      }
      brfApartment: typeof brfApartment.$inferSelect | null
    }
  })[]
}

const toView = (
  { ownershipTerms: terms, parties: partyRows, units: unitRows, charges, ...row }: OwnershipRow,
  on: string,
) => {
  const now = currentTerms({ ...row, parties: partyRows, units: unitRows, charges }, on)
  const parties = shownRows(now.parties, partyRows)
  const units = shownRows(now.units, unitRows)
  // The apartment's facts come from the apartment register, not the bostadsrätt.
  const apartment = units.find((u) => u.unit.kind === 'apartment')?.unit.brfApartment ?? null
  return {
    ...row,
    /** The månadsavgift in force (the base charge). */
    rentOre: now.rentOre,
    rentInterval: now.rentInterval,
    baseChargeId: now.baseCharge?.id ?? null,
    charges: [...charges].sort((a, b) => a.fromDate.localeCompare(b.fromDate)),
    partyRows: partyRows.map(({ party, ...p }) => ({ ...p, name: party.name })),
    unitRows: unitRows.map(({ unit, ...u }) => ({ ...u, label: unit.label })),
    apartmentUnitId: units.find((u) => u.unit.kind === 'apartment')?.unitId ?? null,
    shareRatio: apartment?.shareRatio ?? null,
    depositOre: apartment?.depositOre ?? null,
    grantedOn: apartment?.grantedOn ?? null,
    previousAgreementId: terms?.previousAgreementId ?? null,
    /** The owner named first. */
    owner: primaryParty(parties).party,
    ownerNames: joinNames(parties.map((p) => p.party.name)),
    owners: parties.map((p) => ({
      ...p.party,
      sharePercent: p.sharePercent ?? 0,
      receivesInvoices: p.receivesInvoices,
    })),
    units: units
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
  }
}

export type OwnershipView = ReturnType<typeof toView>

const isOwnership = (organizationId: string) =>
  inCompany(agreement, organizationId, eq(agreement.kind, 'tenant_ownership'))

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
  const pledges = yield* activePledgeCounts(rows.map((r) => r.id))
  return rows.map((row) => ({ ...toView(row, on), activePledges: pledges.get(row.id) ?? 0 }))
}).pipe(Effect.withSpan('ownerships.listOwnerships'))

/** The bostadsrätt with its owners' contact details, and the ones before and after a sale. */
export const getOwnership = Effect.fn('ownerships.getOwnership')(function* (ownershipId: string) {
  yield* requirePermission(read)
  const row = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findFirst({
      where: and(eq(agreement.id, ownershipId), isOwnership(organizationId)),
      with: withOwnershipDetails,
    }),
  ).pipe(orNotFound('ownership', ownershipId))
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
        inCompany(
          agreement,
          organizationId,
          sql`(${agreement.id} = ${view.previousAgreementId} or ${ownershipTerms.previousAgreementId} = ${view.id})`,
        ),
      ),
  )
  const previous = linked.find((l) => l.id === view.previousAgreementId) ?? null
  const next = linked.find((l) => l.previousAgreementId === view.id) ?? null

  // Contact details are tenant data, shown only to those who may read tenants.
  const contacts = (yield* hasPermission({ tenant: ['read'] }))
    ? yield* orgQuery((db, organizationId) =>
        db.query.party.findMany({
          columns: { id: true, email: true, phone: true },
          where: inCompany(
            party,
            organizationId,
            inArray(
              party.id,
              view.owners.map((o) => o.id),
            ),
          ),
        }),
      )
    : []
  return {
    ...view,
    /** In priority order: active ones numbered, then released ones. */
    pledges: (yield* pledgesFor([view.id])).get(view.id) ?? [],
    /** One-off charges an avi in force has billed; the rest are still to come. */
    billedChargeIds: [...(yield* billedOnceChargeIds([view.id]))],
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
  owners: readonly { partyId: string; sharePercent: number }[]
  invoiceRecipientId: string | null
}) =>
  Effect.gen(function* () {
    const result = ownershipParties(input.owners, input.invoiceRecipientId)
    if (!result.ok) return yield* new Conflict({ message: ownersProblemMessages[result.problem] })
    yield* checkPartiesExist(input.owners.map((o) => o.partyId))
    return result.parties
  })

/** The apartment's facts for the apartment register (lägenhetsförteckning). */
const registerValues = (input: CreateOwnershipInput) => ({
  shareRatio: input.shareRatio,
  depositOre: input.depositOre,
  grantedOn: input.grantedOn,
})

/** The chosen units that are apartments: they get the register entry. */
const apartmentIds = (unitIds: readonly string[]) =>
  orgQuery((db, organizationId) =>
    db
      .select({ id: unitTable.id })
      .from(unitTable)
      .where(
        inCompany(
          unitTable,
          organizationId,
          inArray(unitTable.id, [...unitIds]),
          eq(unitTable.kind, 'apartment'),
        ),
      ),
  ).pipe(Effect.map((rows) => rows.map((r) => r.id)))

/** Writes the register entry for each apartment; it belongs to the apartment, not the right. */
const upsertRegister = (
  db: Db,
  organizationId: string,
  unitIds: readonly string[],
  values: ReturnType<typeof registerValues>,
) =>
  unitIds.map((unitId) =>
    db
      .insert(brfApartment)
      .values({ unitId, organizationId, ...values })
      .onConflictDoUpdate({ target: brfApartment.unitId, set: values }),
  )

/** The next avtalsnummer, in the same series as leases, numbered in the insert itself. */
const nextNumber = (organizationId: string) =>
  sql<number>`(select coalesce(max(${agreement.number}), 0) + 1 from ${agreement} where ${agreement.organizationId} = ${organizationId})`

export const createOwnership = Effect.fn('ownerships.createOwnership')(function* (
  input: CreateOwnershipInput,
) {
  yield* requirePermission(manage)
  const parties = yield* checkOwners(input)
  const unitIds = yield* checkUnitsFree(input.unitIds, { start: input.startDate, end: null })
  const apartments = yield* apartmentIds(unitIds)
  const id = crypto.randomUUID()
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db.insert(agreement).values({
        id,
        organizationId,
        number: nextNumber(organizationId),
        kind: 'tenant_ownership',
        startDate: input.startDate,
        endDate: null,
        invoiceInterval: input.invoiceInterval,
      }),
      // The månadsavgift: monthly and outside VAT, like all member fees.
      db.insert(charge).values({
        organizationId,
        agreementId: id,
        kind: 'fee',
        amountOre: input.feeOre,
        interval: 'monthly',
        vat: false,
        fromDate: input.startDate,
      }),
      db.insert(ownershipTerms).values({ agreementId: id, organizationId }),
      db.insert(agreementParty).values(
        parties.map((p) => ({
          ...p,
          agreementId: id,
          organizationId,
          fromDate: input.startDate,
        })),
      ),
      db.insert(agreementUnit).values(
        unitIds.map((unitId) => ({
          agreementId: id,
          unitId,
          organizationId,
          fromDate: input.startDate,
        })),
      ),
      ...upsertRegister(db, organizationId, apartments, registerValues(input)),
    ]),
  )
  return { id }
})

/**
 * Corrects the owners, units, fee and the apartment's register entry. A sale is a transfer,
 * which keeps the sellers' bostadsrätt as history; a new fee from a date is `changeBaseCharge`.
 * Issued avier are not touched.
 */
export const updateOwnership = Effect.fn('ownerships.updateOwnership')(function* (
  input: UpdateOwnershipInput,
) {
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
  const apartments = yield* apartmentIds(unitIds)
  const base = yield* correctBaseCharge(
    current,
    { startDate: input.startDate, amountOre: input.feeOre, interval: 'monthly', vat: false },
    yield* today,
  )
  if (!base) return yield* new Conflict({ message: 'Bostadsrätten saknar avgift' })
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db
        .update(agreement)
        .set({ startDate: input.startDate, invoiceInterval: input.invoiceInterval })
        .where(inCompany(agreement, organizationId, eq(agreement.id, current.id))),
      db
        .update(charge)
        .set(base.values)
        .where(inCompany(charge, organizationId, eq(charge.id, base.id))),
      ...correctOpenTerms(
        db,
        organizationId,
        current.id,
        { oldStart: current.startDate, newStart: input.startDate },
        { parties: current.partyRows, units: current.unitRows },
        { parties, unitIds },
      ),
      ...upsertRegister(db, organizationId, apartments, registerValues(input)),
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
 * back to it. The förening's överlåtelseavgift, if it charges one, goes on the buyers' first avi
 * (the bylaws usually have the buyer pay it). All in one batch.
 */
export const transferOwnership = Effect.fn('ownerships.transferOwnership')(function* (
  input: TransferOwnershipInput,
) {
  yield* requirePermission(manage)
  const seller = yield* getOwnership(input.ownershipId)
  const problem = transferProblem(seller, input.transferDate)
  if (problem) return yield* new Conflict({ message: transferProblemMessages[problem] })
  const parties = yield* checkOwners(input)
  // Pledges stay on the sellers' right. Those the lenders have asked to release can be released
  // in the same step; any left in force are the board's to follow up.
  const on = yield* today
  const active = yield* activePledgesOf(seller.id, on)
  const releaseIds = [...new Set(input.releasePledgeIds ?? [])]
  if (releaseIds.some((id) => !active.some((p) => p.id === id))) {
    return yield* new Conflict({
      message: 'En av pantsättningarna är inte längre registrerad på bostadsrätten',
    })
  }
  const me = yield* CurrentUser
  const unitIds = yield* checkUnitsFree(
    seller.units.map((u) => u.id),
    { start: input.transferDate, end: null },
    seller.id,
  )
  const carried = seller.charges.filter(
    (c) => c.interval !== 'once' && inForceOn(c, input.transferDate),
  )
  if (!carried.some((c) => c.kind === 'fee')) {
    return yield* new Conflict({ message: 'Bostadsrätten har ingen avgift på tillträdesdagen' })
  }
  const id = crypto.randomUUID()
  const fee = yield* feeCharge('transfer_fee', yield* loadFeeTerms, {
    charge: input.chargeTransferFee ?? false,
    date: input.transferDate,
    agreement: { id, startDate: input.transferDate },
    description: 'Överlåtelseavgift',
  })
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db
        .update(agreement)
        .set({ endDate: sellersLastDay(input.transferDate) })
        .where(inCompany(agreement, organizationId, eq(agreement.id, seller.id))),
      db.insert(agreement).values({
        id,
        organizationId,
        number: nextNumber(organizationId),
        kind: 'tenant_ownership',
        startDate: input.transferDate,
        endDate: null,
        invoiceInterval: seller.invoiceInterval,
      }),
      // The buyers take over every recurring charge in force on their first day.
      db.insert(charge).values(
        carried.map((c) => ({
          organizationId,
          agreementId: id,
          kind: c.kind,
          description: c.description,
          amountOre: c.amountOre,
          interval: c.interval,
          vat: c.vat,
          fromDate: input.transferDate,
          toDate: c.toDate,
        })),
      ),
      db
        .insert(ownershipTerms)
        .values({ agreementId: id, organizationId, previousAgreementId: seller.id }),
      db.insert(agreementParty).values(
        parties.map((p) => ({
          ...p,
          agreementId: id,
          organizationId,
          fromDate: input.transferDate,
        })),
      ),
      db.insert(agreementUnit).values(
        unitIds.map((unitId) => ({
          agreementId: id,
          unitId,
          organizationId,
          fromDate: input.transferDate,
        })),
      ),
      ...(fee ? [db.insert(charge).values({ ...fee, organizationId })] : []),
      ...releaseStatements(db, organizationId, releaseIds, {
        releasedOn: on,
        note: 'Avregistrerad vid överlåtelsen',
        userId: me.id,
      }),
    ]),
  )
  return { id, feeOre: fee?.amountOre ?? null }
})

/**
 * Deletes a bostadsrätt that has never been invoiced. If it came from a transfer, this undoes the
 * sale: the sellers' bostadsrätt runs on again.
 */
export const deleteOwnership = Effect.fn('ownerships.deleteOwnership')(function* (
  ownershipId: string,
) {
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
  // The apartment register keeps every pledge, so a bostadsrätt that has had one stays.
  if (current.pledges.length > 0) {
    return yield* new Conflict({
      message: 'Bostadsrätten har pantsättningar i lägenhetsförteckningen och kan inte tas bort.',
    })
  }
  const previous = current.previous
  yield* orgQuery((db, organizationId): Promise<unknown> => {
    const remove = db
      .delete(agreement)
      .where(inCompany(agreement, organizationId, eq(agreement.id, current.id)))
    if (!previous) return db.batch([remove])
    return db.batch([
      remove,
      db
        .update(agreement)
        .set({ endDate: null })
        .where(
          inCompany(
            agreement,
            organizationId,
            eq(agreement.id, previous.id),
            eq(agreement.endDate, sellersLastDay(current.startDate)),
          ),
        ),
    ])
  })
  return { previousId: previous?.id ?? null }
})

/**
 * A bostadsrätt as the apartment register describes it on `on`: the apartment, what goes with it
 * and the holders then. No permission check; the register's documents check their own.
 */
export const registerEntryIn = Effect.fn('ownerships.registerEntryIn')(function* (
  organizationId: string,
  ownershipId: string,
  on: (row: { startDate: string; endDate: string | null }) => string,
) {
  const row = yield* query((db) =>
    db.query.agreement.findFirst({
      where: and(eq(agreement.id, ownershipId), isOwnership(organizationId)),
      with: withOwnershipDetails,
    }),
  ).pipe(orNotFound('ownership', ownershipId))
  const view = toView(row, on(row))
  const apartment = row.units.find((u) => u.unit.kind === 'apartment')?.unit ?? null
  return {
    ownership: {
      id: view.id,
      number: view.number,
      startDate: view.startDate,
      endDate: view.endDate,
    },
    apartment: apartment && {
      label: apartment.label,
      designation: apartment.property.designation,
      streetAddress: apartment.property.streetAddress,
      postalCode: apartment.property.postalCode,
      city: apartment.property.city,
      areaSqm: apartment.areaSqm,
      rooms: apartment.rooms,
      shareRatio: apartment.brfApartment?.shareRatio ?? null,
      depositOre: apartment.brfApartment?.depositOre ?? null,
      grantedOn: apartment.brfApartment?.grantedOn ?? null,
    },
    /** Storage and parking that go with the apartment. */
    otherUnits: view.units
      .filter((u) => u.kind !== 'apartment')
      .map((u) => ({ label: u.label, kind: u.kind })),
    holders: view.owners.map((o) => ({ name: o.name, sharePercent: o.sharePercent })),
  }
})

/** The register entry in the company in focus (see `registerEntryIn`). */
export const registerEntry = (
  ownershipId: string,
  on: (row: { startDate: string; endDate: string | null }) => string,
) =>
  Effect.gen(function* () {
    return yield* registerEntryIn((yield* CurrentOrganization).id, ownershipId, on)
  })

/**
 * An extract from the apartment register (lägenhetsförteckningen) for one bostadsrätt as it stood
 * on `onDate`: the förening, the apartment, the holders then, and the pledges in force then in
 * priority order (with released ones if asked for). The extract isn't stored; producing one is
 * recorded in the audit log by its server function.
 */
export const ownershipExtract = Effect.fn('ownerships.ownershipExtract')(function* (input: {
  ownershipId: string
  onDate: string
  includeReleased: boolean
}) {
  yield* requirePermission(read)
  const on = yield* today
  if (input.onDate > on) {
    return yield* new Conflict({ message: 'Utdraget kan inte avse en dag i framtiden' })
  }
  const entry = yield* registerEntry(input.ownershipId, () => input.onDate)
  const { startDate, endDate } = entry.ownership
  if (input.onDate < startDate || (endDate !== null && input.onDate > endDate)) {
    return yield* new Conflict({
      message: endDate
        ? `Bostadsrätten gällde ${startDate} – ${endDate}. Välj en dag då.`
        : `Bostadsrätten gäller från ${startDate}. Välj en dag från då.`,
    })
  }
  const pledges =
    (yield* pledgesFor([entry.ownership.id], input.onDate)).get(entry.ownership.id) ?? []
  const seller = yield* loadCompanyDetails
  const me = yield* CurrentUser
  const home = yield* HomeOrganization
  const company = yield* CurrentOrganization
  const producedAt = yield* Clock.currentTimeMillis

  return {
    onDate: input.onDate,
    association: {
      name: seller.organizationName,
      organizationNumber: seller.organizationNumber,
    },
    ownership: { id: entry.ownership.id, number: entry.ownership.number, startDate },
    apartment: entry.apartment,
    otherUnits: entry.otherUnits,
    holders: entry.holders,
    pledges: pledges
      .filter((p) => p.active)
      .map((p) => ({
        priority: p.priority as number,
        creditorName: p.creditorName,
        creditorOrganizationNumber: p.creditorOrganizationNumber,
        reference: p.reference,
        notifiedOn: p.notifiedOn,
      })),
    released: input.includeReleased
      ? pledges
          .filter((p) => !p.active)
          .map((p) => ({
            creditorName: p.creditorName,
            reference: p.reference,
            notifiedOn: p.notifiedOn,
            releasedOn: p.releasedOn as string,
          }))
      : null,
    producedBy: {
      name: me.name,
      /** The manager's company, when someone from a managing company produced it. */
      on: company.grant ? home.name : null,
    },
    producedOn: stockholmDate(producedAt),
  }
})
