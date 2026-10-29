import { asc, desc, eq, inArray, ne, or } from 'drizzle-orm'
import { Effect } from 'effect'
import { invoice, party } from '#/db/schema'
import type { Charge } from '#/features/agreements/charges'
import { rentFields } from '#/features/agreements/current'
import type { PartyRole } from '#/features/agreements/kinds'
import { agreementTerms } from '#/features/agreements/terms'
import { leaseStatus } from '#/features/leases/terms'
import { statusFromMoney } from '#/features/ledger/postings'
import { invoiceMoneyFor } from '#/features/ledger/program'
import type { Permissions } from '#/lib/permissions'
import { blankToNull } from '#/lib/schemas'
import { hasPermission, requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { today } from '#/server/today'
import { formatOrganizationNumber } from './organization-number'
import type { CreateTenantInput, UpdateTenantInput } from './schemas'

const read: Permissions = { tenant: ['read'] }
const manage: Permissions = { tenant: ['manage'] }

/** A party's agreements (leases, or a bostadsrätt), newest first, with lease-shaped terms. */
const partyAgreements = <
  A extends Parameters<typeof agreementTerms>[0] & { number: number; charges: Charge[] },
>(
  parties: readonly { role: PartyRole; agreement: A }[],
  on: string,
) =>
  parties
    .map(({ role, agreement }) => {
      const terms = agreementTerms(agreement)
      /** The tenant's own place on it: `co_tenant` when someone else's lease. */
      return {
        ...agreement,
        ...terms,
        ...rentFields(agreement, on),
        role,
        status: leaseStatus(terms, on),
      }
    })
    .sort((a, b) => b.number - a.number)

/**
 * Tenants by name, each with every agreement they are a party on (newest first) for those who
 * may read leases and units.
 */
export const listTenants = Effect.gen(function* () {
  yield* requirePermission(read)
  const showLeases = yield* hasPermission({ lease: ['read'], property: ['read'] })
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.party.findMany({
      where: inCompany(party, organizationId),
      orderBy: asc(party.name),
      with: {
        agreements: {
          with: {
            agreement: {
              with: {
                leaseTerms: true,
                charges: true,
                units: { with: { unit: { columns: { kind: true, label: true } } } },
              },
            },
          },
        },
      },
    }),
  )
  const on = yield* today
  return rows.map(({ agreements, ...row }) => ({
    ...row,
    leases: showLeases
      ? partyAgreements(agreements, on).map((a) => ({
          id: a.id,
          kind: a.kind,
          number: a.number,
          status: a.status,
          units: a.units.map(({ unit }) => unit),
        }))
      : [],
  }))
}).pipe(Effect.withSpan('tenants.listTenants'))

/** The tenant with every agreement they are on, for the checks below. No permission check. */
const loadTenant = (tenantId: string) =>
  Effect.gen(function* () {
    const row = yield* orgQuery((db, organizationId) =>
      db.query.party.findFirst({
        where: inCompany(party, organizationId, eq(party.id, tenantId)),
        with: {
          agreements: { with: { agreement: { with: { leaseTerms: true, charges: true } } } },
        },
      }),
    ).pipe(orNotFound('tenant', tenantId))
    const { agreements, ...found } = row
    return { ...found, leases: partyAgreements(agreements, yield* today) }
  })

/**
 * The tenant with their leases and invoices, newest first; the leases only for those who may
 * read leases, the invoices only for those who may read invoices.
 */
export const getTenant = Effect.fn('tenants.getTenant')(function* (tenantId: string) {
  yield* requirePermission(read)
  const found = yield* loadTenant(tenantId)
  const showLeases = yield* hasPermission({ lease: ['read'] })
  const showInvoices = yield* hasPermission({ invoice: ['read'] })
  const invoices = showInvoices
    ? yield* orgQuery((db, organizationId) =>
        db.query.invoice.findMany({
          columns: {
            id: true,
            number: true,
            periodStart: true,
            periodEnd: true,
            dueDate: true,
            totalOre: true,
            creditedOre: true,
            voidedAt: true,
          },
          // Every avi on their agreements, and any addressed to them.
          where: inCompany(
            invoice,
            organizationId,
            or(
              eq(invoice.partyId, found.id),
              found.leases.length > 0
                ? inArray(
                    invoice.agreementId,
                    found.leases.map((l) => l.id),
                  )
                : undefined,
            ),
          ),
          orderBy: desc(invoice.number),
        }),
      )
    : []
  const on = yield* today
  const moneyOf = yield* invoiceMoneyFor(invoices.map((i) => i.id))
  return {
    ...found,
    leases: showLeases ? found.leases : [],
    invoices: invoices.map((i) => {
      const m = moneyOf(i.id)
      return { ...i, ...m, status: statusFromMoney(i, m, on) }
    }),
  }
})

const normalize = (input: CreateTenantInput) => ({
  kind: input.kind,
  name: input.name.trim(),
  organizationNumber:
    input.kind === 'company' && input.organizationNumber.trim()
      ? formatOrganizationNumber(input.organizationNumber)
      : null,
  email: blankToNull(input.email),
  phone: blankToNull(input.phone),
  streetAddress: blankToNull(input.streetAddress),
  postalCode: blankToNull(input.postalCode.replace(/\s/g, '')),
  city: blankToNull(input.city),
})

/** Fails if another tenant in the company already has this organisationsnummer. */
const ensureUniqueOrganizationNumber = (organizationNumber: string | null, exceptId?: string) =>
  Effect.gen(function* () {
    if (!organizationNumber) return
    const existing = yield* orgQuery((db, organizationId) =>
      db.query.party.findFirst({
        columns: { name: true },
        where: inCompany(
          party,
          organizationId,
          eq(party.organizationNumber, organizationNumber),
          exceptId ? ne(party.id, exceptId) : undefined,
        ),
      }),
    )
    if (existing) {
      return yield* new Conflict({
        message: `${existing.name} har redan organisationsnummer ${organizationNumber}`,
      })
    }
  })

export const createTenant = Effect.fn('tenants.createTenant')(function* (input: CreateTenantInput) {
  yield* requirePermission(manage)
  const values = normalize(input)
  yield* ensureUniqueOrganizationNumber(values.organizationNumber)
  const [created] = yield* orgQuery((db, organizationId) =>
    db
      .insert(party)
      .values({ organizationId, ...values })
      .returning(),
  )
  return created
})

/** Issued invoices keep the recipient details they were created with. */
export const updateTenant = Effect.fn('tenants.updateTenant')(function* (input: UpdateTenantInput) {
  yield* requirePermission(manage)
  const current = yield* loadTenant(input.tenantId)
  const values = normalize(input)
  yield* ensureUniqueOrganizationNumber(values.organizationNumber, current.id)
  yield* orgQuery((db, organizationId) =>
    db
      .update(party)
      .set(values)
      .where(inCompany(party, organizationId, eq(party.id, current.id))),
  )
  return yield* getTenant(current.id)
})

export const deleteTenant = Effect.fn('tenants.deleteTenant')(function* (tenantId: string) {
  yield* requirePermission(manage)
  const current = yield* loadTenant(tenantId)
  if (current.leases.length > 0) {
    return yield* new Conflict({
      message: `${current.name} har avtal och kan inte tas bort. Ta bort avtalen först.`,
    })
  }
  yield* orgQuery((db, organizationId) =>
    db.delete(party).where(inCompany(party, organizationId, eq(party.id, current.id))),
  )
})
