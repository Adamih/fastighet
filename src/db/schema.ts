import { relations, sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import {
  agreementKinds,
  chargeIntervals,
  chargeKinds,
  partyRoles,
} from '#/features/agreements/kinds'
import { invoiceIntervals, tenantKinds } from '#/features/leases/options'
import { ledgerAccounts, postingKinds } from '#/features/ledger/kinds'
import { paymentStatuses } from '#/features/payments/matching'
import { unitKinds } from '#/features/properties/unit-kinds'
import { feeWaivers } from '#/features/reminders/rules'
import { companyKinds } from '#/features/settings/company-kinds'
import { organization, user } from './auth-schema'

export * from './auth-schema'

// Every domain table carries `organizationId` (the customer company) and every query filters on
// it (`src/server/scoped.ts`). The database backs that up: each domain table has a unique
// `(organization_id, id)` key, and references between domain tables are composite foreign keys
// on it (`sameCompany`), so a row can never point at another company's row.
// Calendar dates are ISO text ("2026-10-23"); money is integer öre.
//
// References that must block deletes (a leased unit, a tenant with leases) use the default
// NO ACTION rather than RESTRICT: SQLite checks NO ACTION at the end of the statement, so
// deleting a whole organization still cascades cleanly.

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const organizationId = () =>
  text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' })

/** The `(organization_id, id)` key that references within the company point at. */
const companyKey = (table: string, t: { organizationId: AnySQLiteColumn; id: AnySQLiteColumn }) =>
  uniqueIndex(`${table}_org_id_uq`).on(t.organizationId, t.id)

/**
 * A reference to another row of the same company: `(organization_id, column)` →
 * `target(organization_id, id)`. A null column isn't checked, as with any foreign key.
 */
const sameCompany = (
  t: { organizationId: AnySQLiteColumn },
  column: AnySQLiteColumn,
  target: { organizationId: AnySQLiteColumn; id: AnySQLiteColumn },
) =>
  foreignKey({
    columns: [t.organizationId, column],
    foreignColumns: [target.organizationId, target.id],
  })

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)

export const property = sqliteTable(
  'property',
  {
    id: id(),
    organizationId: organizationId(),
    // Fastighetsbeteckning, e.g. "Uppsala Kungsängen 12:3".
    designation: text('designation').notNull(),
    name: text('name'),
    streetAddress: text('street_address'),
    postalCode: text('postal_code'),
    city: text('city'),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('property', t),
    uniqueIndex('property_org_designation_uq').on(t.organizationId, t.designation),
  ],
)

export const unit = sqliteTable(
  'unit',
  {
    id: id(),
    organizationId: organizationId(),
    propertyId: text('property_id').notNull(),
    kind: text('kind', { enum: unitKinds }).notNull(),
    // Objektsnummer as printed on contracts and rent notices.
    label: text('label').notNull(),
    areaSqm: real('area_sqm'),
    rooms: integer('rooms'),
    floor: integer('floor'),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('unit', t),
    sameCompany(t, t.propertyId, property).onDelete('cascade'),
    index('unit_org_property_idx').on(t.organizationId, t.propertyId),
    uniqueIndex('unit_property_label_uq').on(t.propertyId, t.label),
  ],
)

// The register of people and companies who can be on an agreement: tenants, co-tenants and the
// owners of a bostadsrätt. The UI calls them hyresgäster or medlemmar after the company type.
export const party = sqliteTable(
  'party',
  {
    id: id(),
    organizationId: organizationId(),
    kind: text('kind', { enum: tenantKinds }).notNull(),
    name: text('name').notNull(),
    // Companies only, normalized to NNNNNN-NNNN. Personnummer is deliberately not stored yet.
    organizationNumber: text('organization_number'),
    email: text('email'),
    phone: text('phone'),
    streetAddress: text('street_address'),
    postalCode: text('postal_code'),
    city: text('city'),
    createdAt: createdAt(),
  },
  (t) => [companyKey('party', t), index('party_org_name_idx').on(t.organizationId, t.name)],
)

// An agreement is what a run invoices: a lease (hyresavtal) or a bostadsrätt. It holds what
// billing needs; lease-only and ownership-only details live in their own tables. Parties are the
// tenants or owners on it (`agreementParty`, pointing at the `party` register).
export const agreement = sqliteTable(
  'agreement',
  {
    id: id(),
    organizationId: organizationId(),
    // Avtalsnummer, sequential per organization across all kinds.
    number: integer('number').notNull(),
    kind: text('kind', { enum: agreementKinds }).notNull(),
    startDate: text('start_date').notNull(),
    // The last day that is billed, or null while it runs until further notice. For a lease this
    // is derived from its terms (`effectiveEndDate`) and written with them; see `leaseTerms`.
    endDate: text('end_date'),
    // What is billed is in `charge`; only how often is on the agreement.
    invoiceInterval: text('invoice_interval', { enum: invoiceIntervals }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('agreement', t),
    uniqueIndex('agreement_org_number_uq').on(t.organizationId, t.number),
  ],
)

// What an agreement bills, from a date: the base charge (rent or a bostadsrätt's fee), add-ons
// such as parking, and one-off amounts. A change ends a charge the day before and starts a new
// one, so history is kept. Rules in `features/agreements/charges.ts`.
export const charge = sqliteTable(
  'charge',
  {
    id: id(),
    organizationId: organizationId(),
    agreementId: text('agreement_id').notNull(),
    kind: text('kind', { enum: chargeKinds }).notNull(),
    // The unit an add-on is for (e.g. a parking space); the rent line then leaves that unit out.
    unitId: text('unit_id'),
    // Shown on the avi; null uses the kind's standard text.
    description: text('description'),
    // Per interval; for a one-off charge the whole amount, negative for a reduction.
    amountOre: integer('amount_ore').notNull(),
    interval: text('interval', { enum: chargeIntervals }).notNull(),
    // Subject to VAT (frivillig skattskyldighet for commercial premises).
    vat: integer('vat', { mode: 'boolean' }).notNull().default(false),
    // A one-off charge is billed on the first avi whose period covers this date.
    fromDate: text('from_date').notNull(),
    toDate: text('to_date'),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('charge', t),
    sameCompany(t, t.agreementId, agreement).onDelete('cascade'),
    sameCompany(t, t.unitId, unit),
    index('charge_agreement_idx').on(t.agreementId),
  ],
)

// The units an agreement covers, from a date (e.g. a parking space added later).
export const agreementUnit = sqliteTable(
  'agreement_unit',
  {
    id: id(),
    organizationId: organizationId(),
    agreementId: text('agreement_id').notNull(),
    unitId: text('unit_id').notNull(),
    fromDate: text('from_date').notNull(),
    toDate: text('to_date'),
  },
  (t) => [
    companyKey('agreement_unit', t),
    sameCompany(t, t.agreementId, agreement).onDelete('cascade'),
    sameCompany(t, t.unitId, unit),
    uniqueIndex('agreement_unit_from_uq').on(t.agreementId, t.unitId, t.fromDate),
    index('agreement_unit_unit_idx').on(t.unitId),
  ],
)

// The tenants (or owners) on an agreement, from a date. Of those in force, one receives the
// invoices; the invoice copies the names of all of them and that party's address.
export const agreementParty = sqliteTable(
  'agreement_party',
  {
    id: id(),
    organizationId: organizationId(),
    agreementId: text('agreement_id').notNull(),
    partyId: text('party_id').notNull(),
    role: text('role', { enum: partyRoles }).notNull(),
    // Ownership share in percent, for co-owners of a bostadsrätt.
    sharePercent: integer('share_percent'),
    receivesInvoices: integer('receives_invoices', { mode: 'boolean' }).notNull().default(false),
    // Order on documents: the first party is named first.
    position: integer('position').notNull(),
    fromDate: text('from_date').notNull(),
    toDate: text('to_date'),
  },
  (t) => [
    companyKey('agreement_party', t),
    sameCompany(t, t.agreementId, agreement).onDelete('cascade'),
    sameCompany(t, t.partyId, party),
    uniqueIndex('agreement_party_from_uq').on(t.agreementId, t.partyId, t.fromDate),
    index('agreement_party_org_party_idx').on(t.organizationId, t.partyId),
  ],
)

// A lease's own terms. `agreement.endDate` is derived from them and written in the same batch.
export const leaseTerms = sqliteTable(
  'lease_terms',
  {
    agreementId: text('agreement_id').primaryKey(),
    organizationId: organizationId(),
    // Set for a fixed-term lease (tidsbestämt); null for an open-ended one (tillsvidare).
    termEndDate: text('term_end_date'),
    extensionMonths: integer('extension_months'),
    noticePeriodMonths: integer('notice_period_months').notNull(),
    noticeDate: text('notice_date'),
    moveOutDate: text('move_out_date'),
  },
  (t) => [sameCompany(t, t.agreementId, agreement).onDelete('cascade')],
)

// A bostadsrätt's own details: who held it before. The apartment's facts (andelstal, insats) are
// in the apartment register, `brfApartment`, since they don't change when it is sold.
export const ownershipTerms = sqliteTable(
  'ownership_terms',
  {
    agreementId: text('agreement_id').primaryKey(),
    organizationId: organizationId(),
    // The sellers' bostadsrätt when this one came from a transfer (överlåtelse).
    previousAgreementId: text('previous_agreement_id'),
  },
  (t) => [
    sameCompany(t, t.agreementId, agreement).onDelete('cascade'),
    sameCompany(t, t.previousAgreementId, agreement),
  ],
)

// The BRF's apartment register (lägenhetsförteckning): one row per apartment upplåten med
// bostadsrätt, keyed by its unit. It outlives every sale of the right.
export const brfApartment = sqliteTable(
  'brf_apartment',
  {
    unitId: text('unit_id').primaryKey(),
    organizationId: organizationId(),
    // Andelstal, in percent of the association's total; fees are split by it.
    shareRatio: real('share_ratio'),
    // Insats and upplåtelseavgift paid when the right was first granted.
    depositOre: integer('deposit_ore'),
    grantFeeOre: integer('grant_fee_ore'),
    // Upplåtelsedatum.
    grantedOn: text('granted_on'),
  },
  (t) => [sameCompany(t, t.unitId, unit).onDelete('cascade')],
)

// A pledge (pantsättning) of a bostadsrätt, as notified by the lender, for the apartment register
// (bostadsrättslagen 9 kap.). Kept for good: a release closes it, and a mistake is corrected by
// releasing with a note. Priority among a right's pledges follows `notifiedOn`; rules in
// `features/pledges/rules.ts`. A pledge stays on the right it was given on; a sale never moves it.
export const pledge = sqliteTable(
  'pledge',
  {
    id: id(),
    organizationId: organizationId(),
    /** The bostadsrätt (`agreement` of kind `tenant_ownership`). */
    agreementId: text('agreement_id').notNull(),
    /** The lender (panthavare), usually a bank. */
    creditorName: text('creditor_name').notNull(),
    creditorOrganizationNumber: text('creditor_organization_number'),
    /** The lender's own reference, e.g. a loan or case number. */
    reference: text('reference'),
    /** The day the lender's notice reached the förening; sets the priority. */
    notifiedOn: text('notified_on').notNull(),
    note: text('note'),
    registeredBy: text('registered_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    /** The day the release was registered; from then on the pledge is no longer in force. */
    releasedOn: text('released_on'),
    /** At whose request, or why (e.g. "På begäran av Banken AB", "Registrerad av misstag"). */
    releaseNote: text('release_note'),
    releasedBy: text('released_by').references(() => user.id, { onDelete: 'set null' }),
    /** Where the lender wants the förening's confirmations, if given when registering. */
    confirmationEmail: text('confirmation_email'),
    /** When the lender was sent confirmation of the registration (by email or by post). */
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    /** When the lender was sent confirmation of the release. */
    releaseConfirmedAt: integer('release_confirmed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    companyKey('pledge', t),
    // No cascade: a bostadsrätt with pledges can't be deleted (`deleteOwnership` explains why).
    sameCompany(t, t.agreementId, agreement),
    index('pledge_org_agreement_idx').on(t.organizationId, t.agreementId),
  ],
)

// A lease's index clause (indexklausul): part of the base rent follows KPI, adjusted each year
// by an `index` charge. Commercial leases of at least three years only (12 kap. 19 § JB); rules
// in `features/indexation/rules.ts`.
export const indexClause = sqliteTable(
  'index_clause',
  {
    agreementId: text('agreement_id').primaryKey(),
    organizationId: organizationId(),
    // The share of the base rent that follows the index, in percent (usually 100).
    sharePercent: integer('share_percent').notNull().default(100),
    // The KPI month the clause starts from, "2025-10": usually October the year before the start.
    baseMonth: text('base_month').notNull(),
    // The month the rent is adjusted each year (1 = January), from KPI three months earlier.
    adjustmentMonth: integer('adjustment_month').notNull().default(1),
    // The rent never goes below the base rent (the supplement is never negative).
    floorAtBase: integer('floor_at_base', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [sameCompany(t, t.agreementId, agreement).onDelete('cascade')],
)

// One yearly adjustment (indexuppräkning) of a lease: the KPI values and base rent it used, and
// the `index` charge it started. At most one per lease and date, so a run can be repeated.
export const indexAdjustment = sqliteTable(
  'index_adjustment',
  {
    id: id(),
    organizationId: organizationId(),
    agreementId: text('agreement_id').notNull(),
    // The day the new supplement applies from.
    effectiveDate: text('effective_date').notNull(),
    baseMonth: text('base_month').notNull(),
    baseKpiHundredths: integer('base_kpi_hundredths').notNull(),
    kpiMonth: text('kpi_month').notNull(),
    kpiHundredths: integer('kpi_hundredths').notNull(),
    // The base rent per year it was computed from, and the supplement per year.
    baseRentOre: integer('base_rent_ore').notNull(),
    supplementOre: integer('supplement_ore').notNull(),
    chargeId: text('charge_id'),
    // When the tenant was emailed about the new rent, if they were.
    notifiedAt: integer('notified_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('index_adjustment', t),
    sameCompany(t, t.agreementId, agreement).onDelete('cascade'),
    sameCompany(t, t.chargeId, charge),
    uniqueIndex('index_adjustment_agreement_date_uq').on(t.agreementId, t.effectiveDate),
  ],
)

// KPI (konsumentprisindex, 1980=100) per month, from SCB. Reference data, not company data: the
// one table without `organizationId`. Domain code only reads it; values come from SCB alone (the
// baseline history in a migration, new months through `syncKpi`), never from a form.
export const kpi = sqliteTable('kpi', {
  // "2026-10"
  month: text('month').primaryKey(),
  // The index times 100, e.g. 419.35 → 41935.
  valueHundredths: integer('value_hundredths').notNull(),
})

// Prisbasbelopp per year (socialförsäkringsbalken 2 kap.), set by the government each autumn
// for the next year. Reference data shared by every company, like `kpi`: domain code only reads
// it, and values come from a migration, never a form. A BRF's fees are capped by it.
export const priceBaseAmount = sqliteTable('price_base_amount', {
  year: integer('year').primaryKey(),
  amountKr: integer('amount_kr').notNull(),
})

// Riksbanken's referensränta (räntelagen 9 §), set for each calendar half-year: in force from
// `fromDate` until the next row. Reference data like `kpi`, from a migration only. Late payment
// interest is it plus eight percentage points (`features/interest/rules.ts`).
export const referenceRate = sqliteTable('reference_rate', {
  // "2026-07-01"
  fromDate: text('from_date').primaryKey(),
  // 2,00 % → 200.
  basisPoints: integer('basis_points').notNull(),
})

export const propertyRelations = relations(property, ({ many }) => ({ units: many(unit) }))

export const unitRelations = relations(unit, ({ one, many }) => ({
  property: one(property, { fields: [unit.propertyId], references: [property.id] }),
  agreements: many(agreementUnit),
  brfApartment: one(brfApartment),
}))

export const brfApartmentRelations = relations(brfApartment, ({ one }) => ({
  unit: one(unit, { fields: [brfApartment.unitId], references: [unit.id] }),
}))

export const chargeRelations = relations(charge, ({ one }) => ({
  agreement: one(agreement, { fields: [charge.agreementId], references: [agreement.id] }),
}))

export const partyRelations = relations(party, ({ many }) => ({
  agreements: many(agreementParty),
  invoices: many(invoice),
  portalAccess: many(partyAccess),
  portalInvitations: many(portalInvitation),
}))

export const agreementRelations = relations(agreement, ({ one, many }) => ({
  parties: many(agreementParty),
  units: many(agreementUnit),
  charges: many(charge),
  leaseTerms: one(leaseTerms),
  ownershipTerms: one(ownershipTerms),
  indexClause: one(indexClause),
  invoices: many(invoice),
  pledges: many(pledge),
}))

export const pledgeRelations = relations(pledge, ({ one }) => ({
  agreement: one(agreement, { fields: [pledge.agreementId], references: [agreement.id] }),
}))

export const agreementUnitRelations = relations(agreementUnit, ({ one }) => ({
  agreement: one(agreement, { fields: [agreementUnit.agreementId], references: [agreement.id] }),
  unit: one(unit, { fields: [agreementUnit.unitId], references: [unit.id] }),
}))

export const agreementPartyRelations = relations(agreementParty, ({ one }) => ({
  agreement: one(agreement, { fields: [agreementParty.agreementId], references: [agreement.id] }),
  party: one(party, { fields: [agreementParty.partyId], references: [party.id] }),
}))

export const leaseTermsRelations = relations(leaseTerms, ({ one }) => ({
  agreement: one(agreement, { fields: [leaseTerms.agreementId], references: [agreement.id] }),
}))

export const indexClauseRelations = relations(indexClause, ({ one }) => ({
  agreement: one(agreement, { fields: [indexClause.agreementId], references: [agreement.id] }),
}))

export const ownershipTermsRelations = relations(ownershipTerms, ({ one }) => ({
  agreement: one(agreement, { fields: [ownershipTerms.agreementId], references: [agreement.id] }),
}))

/** Seller details printed on invoices, and the company type. One row per organization, created on first save. */
export const organizationSettings = sqliteTable('organization_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  // Normalized to NNNNNN-NNNN and NNN(N)-NNNN.
  organizationNumber: text('organization_number'),
  bankgiro: text('bankgiro'),
  streetAddress: text('street_address'),
  postalCode: text('postal_code'),
  city: text('city'),
  email: text('email'),
  phone: text('phone'),
  // Godkänd för F-skatt, printed on invoices.
  fSkatt: integer('f_skatt', { mode: 'boolean' }).notNull().default(true),
  // A landlord or a BRF; decides the app's wording and defaults.
  kind: text('kind', { enum: companyKinds }).notNull().default('landlord'),
  // Payment reminders: the fee with an avi's first reminder (null: no fee agreed), the days to
  // wait after the due date or last reminder, and the days the payer gets. See
  // `features/reminders/rules.ts`.
  reminderFeeOre: integer('reminder_fee_ore'),
  reminderIntervalDays: integer('reminder_interval_days').notNull().default(10),
  reminderDueDays: integer('reminder_due_days').notNull().default(10),
  // Waive an avi's reminder fee when the avi itself is paid by the reminder's due date.
  waiveReminderFeeByDueDate: integer('waive_reminder_fee_by_due_date', { mode: 'boolean' })
    .notNull()
    .default(false),
  // Charge dröjsmålsränta on avier paid late, on the next avi, unless it comes to less than the
  // minimum (null: any whole krona). See `features/interest`.
  lateInterest: integer('late_interest', { mode: 'boolean' }).notNull().default(false),
  lateInterestMinimumOre: integer('late_interest_minimum_ore'),
  // Bookkeeping: the month the financial year starts (1 = January), and the company's own
  // account numbers for the SIE export as JSON; unset ones are BAS (`features/bookkeeping`).
  financialYearStartMonth: integer('financial_year_start_month').notNull().default(1),
  bookkeepingAccounts: text('bookkeeping_accounts'),
  // A BRF's pantsättningsavgift and överlåtelseavgift as basis points of the prisbasbelopp
  // (100 = 1 %), within the legal caps; null when the bylaws don't charge it. See
  // `features/ownerships/fees.ts`.
  pledgeFeeBasisPoints: integer('pledge_fee_basis_points'),
  // A tier we set ourselves (`features/billing/tiers.ts`): a sales deal invoiced outside Stripe,
  // a pilot. It wins over the Stripe subscription; null means the subscription decides.
  planOverride: text('plan_override'),
  transferFeeBasisPoints: integer('transfer_fee_basis_points'),
  // Mina sidor (`features/portal`): whether tenants and members may change their own contact
  // details there, and the email and phone the portal shows them for questions (null: the
  // company's own).
  portalContactEdits: integer('portal_contact_edits', { mode: 'boolean' }).notNull().default(true),
  portalContactEmail: text('portal_contact_email'),
  portalContactPhone: text('portal_contact_phone'),
})

// Issued invoices are accounting records: they are never deleted, only voided, and their
// numbers run without gaps per organization. Recipient details are copied at issue time.
export const invoice = sqliteTable(
  'invoice',
  {
    id: id(),
    organizationId: organizationId(),
    number: integer('number').notNull(),
    ocr: text('ocr').notNull(),
    agreementId: text('agreement_id').notNull(),
    // The party that received the invoice.
    partyId: text('party_id').notNull(),
    recipientName: text('recipient_name').notNull(),
    recipientStreetAddress: text('recipient_street_address'),
    recipientPostalCode: text('recipient_postal_code'),
    recipientCity: text('recipient_city'),
    recipientEmail: text('recipient_email'),
    // The seller as issued (`IssuedSeller`, JSON): bankgiro, name, address, org.nr, F-skatt.
    // Null on avier from before 0018, which show the current company details.
    seller: text('seller'),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    issueDate: text('issue_date').notNull(),
    dueDate: text('due_date').notNull(),
    netOre: integer('net_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    totalOre: integer('total_ore').notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    // Sum of the credit notes issued against this invoice (incl. VAT), cached in the same batch
    // that creates one; the one-avi-per-period index needs it. What is owed and paid comes from
    // the ledger (`ledgerEntry`), not from fields on the avi.
    creditedOre: integer('credited_ore').notNull().default(0),
    // A corrected avi issued for the same lease and period after this one was voided or credited
    // in full points back to the avi it replaces.
    replacesInvoiceId: text('replaces_invoice_id'),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('invoice', t),
    sameCompany(t, t.agreementId, agreement),
    sameCompany(t, t.partyId, party),
    sameCompany(t, t.replacesInvoiceId, t),
    uniqueIndex('invoice_org_number_uq').on(t.organizationId, t.number),
    // An agreement has at most one avi in force per period. Voided and fully credited avier no longer
    // count, so a corrected one can replace them. Invoice runs skip any period already invoiced,
    // which keeps them safe to repeat.
    uniqueIndex('invoice_agreement_period_uq')
      .on(t.agreementId, t.periodStart)
      .where(sql`${t.voidedAt} is null and ${t.creditedOre} < ${t.totalOre}`),
    index('invoice_org_due_idx').on(t.organizationId, t.dueDate),
  ],
)

export const invoiceLine = sqliteTable(
  'invoice_line',
  {
    id: id(),
    organizationId: organizationId(),
    invoiceId: text('invoice_id').notNull(),
    position: integer('position').notNull(),
    // What the line is for, which bookkeeping maps to accounts; and the charge that billed it.
    kind: text('kind', { enum: chargeKinds }).notNull(),
    chargeId: text('charge_id'),
    description: text('description').notNull(),
    netOre: integer('net_ore').notNull(),
    vatRatePercent: integer('vat_rate_percent').notNull(),
    vatOre: integer('vat_ore').notNull(),
  },
  (t) => [
    companyKey('invoice_line', t),
    sameCompany(t, t.invoiceId, invoice).onDelete('cascade'),
    sameCompany(t, t.chargeId, charge),
    index('invoice_line_invoice_idx').on(t.invoiceId),
    index('invoice_line_charge_idx').on(t.chargeId),
  ],
)

export const invoiceRelations = relations(invoice, ({ one, many }) => ({
  agreement: one(agreement, { fields: [invoice.agreementId], references: [agreement.id] }),
  party: one(party, { fields: [invoice.partyId], references: [party.id] }),
  lines: many(invoiceLine),
  ledgerEntries: many(ledgerEntry),
  reminders: many(paymentReminder),
  lateInterest: one(lateInterest),
  creditNotes: many(creditNote),
  replaces: one(invoice, {
    fields: [invoice.replacesInvoiceId],
    references: [invoice.id],
    relationName: 'replacement',
  }),
  replacedBy: many(invoice, { relationName: 'replacement' }),
}))

export const invoiceLineRelations = relations(invoiceLine, ({ one }) => ({
  invoice: one(invoice, { fields: [invoiceLine.invoiceId], references: [invoice.id] }),
}))

// A credit note (kreditfaktura) corrects an issued invoice. Like invoices it is an accounting
// record: never deleted, numbered without gaps per organization in its own series. Amounts are
// positive and mean "credited"; the document prints them as negative. Recipient details are
// copied from the invoice it credits.
export const creditNote = sqliteTable(
  'credit_note',
  {
    id: id(),
    organizationId: organizationId(),
    number: integer('number').notNull(),
    invoiceId: text('invoice_id').notNull(),
    reason: text('reason').notNull(),
    recipientName: text('recipient_name').notNull(),
    recipientStreetAddress: text('recipient_street_address'),
    recipientPostalCode: text('recipient_postal_code'),
    recipientCity: text('recipient_city'),
    recipientEmail: text('recipient_email'),
    // The seller as issued, as on `invoice`; null on credit notes from before 0018.
    seller: text('seller'),
    issueDate: text('issue_date').notNull(),
    netOre: integer('net_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    totalOre: integer('total_ore').notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('credit_note', t),
    sameCompany(t, t.invoiceId, invoice),
    uniqueIndex('credit_note_org_number_uq').on(t.organizationId, t.number),
    index('credit_note_invoice_idx').on(t.invoiceId),
  ],
)

export const creditNoteLine = sqliteTable(
  'credit_note_line',
  {
    id: id(),
    organizationId: organizationId(),
    creditNoteId: text('credit_note_id').notNull(),
    position: integer('position').notNull(),
    // What is credited, for bookkeeping: the kind of the invoice line it reverses.
    kind: text('kind', { enum: chargeKinds }).notNull(),
    description: text('description').notNull(),
    netOre: integer('net_ore').notNull(),
    vatRatePercent: integer('vat_rate_percent').notNull(),
    vatOre: integer('vat_ore').notNull(),
  },
  (t) => [
    companyKey('credit_note_line', t),
    sameCompany(t, t.creditNoteId, creditNote).onDelete('cascade'),
    index('credit_note_line_note_idx').on(t.creditNoteId),
  ],
)

export const creditNoteRelations = relations(creditNote, ({ one, many }) => ({
  invoice: one(invoice, { fields: [creditNote.invoiceId], references: [invoice.id] }),
  lines: many(creditNoteLine),
}))

export const creditNoteLineRelations = relations(creditNoteLine, ({ one }) => ({
  creditNote: one(creditNote, {
    fields: [creditNoteLine.creditNoteId],
    references: [creditNote.id],
  }),
}))

// A payment reminder (påminnelse) sent for an overdue avi. Like the avi it is never deleted. Its
// fee, if any, is posted to the avi's receivable in the ledger in the same batch.
export const paymentReminder = sqliteTable(
  'payment_reminder',
  {
    id: id(),
    organizationId: organizationId(),
    invoiceId: text('invoice_id').notNull(),
    // 1 for the first reminder of the avi, 2 for the second, …
    sequence: integer('sequence').notNull(),
    sentOn: text('sent_on').notNull(),
    // The reminder's own due date.
    dueDate: text('due_date').notNull(),
    // What the reminder asked for, and its fee. The fee is a one-off charge on the agreement
    // (`feeChargeId`), billed by its next avi; it was posted to the avi itself before 0012, so
    // older rows' `owedOre` include it and they have no charge.
    owedOre: integer('owed_ore').notNull(),
    feeOre: integer('fee_ore').notNull().default(0),
    feeChargeId: text('fee_charge_id'),
    // When and why the fee was waived (`features/reminders/rules.ts`); its charge is deleted and
    // `feeChargeId` cleared.
    feeWaivedOn: text('fee_waived_on'),
    feeWaiver: text('fee_waiver', { enum: feeWaivers }),
    recipientEmail: text('recipient_email').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('payment_reminder', t),
    sameCompany(t, t.invoiceId, invoice),
    sameCompany(t, t.feeChargeId, charge),
    uniqueIndex('payment_reminder_invoice_sequence_uq').on(t.invoiceId, t.sequence),
  ],
)

export const paymentReminderRelations = relations(paymentReminder, ({ one }) => ({
  invoice: one(invoice, { fields: [paymentReminder.invoiceId], references: [invoice.id] }),
  feeCharge: one(charge, { fields: [paymentReminder.feeChargeId], references: [charge.id] }),
}))

// Dröjsmålsränta charged for an avi paid late: once per avi, as a one-off charge on its
// agreement that the next avi bills. Removing the charge before it is billed (the charges panel)
// removes this too, which is how it is waived.
export const lateInterest = sqliteTable(
  'late_interest',
  {
    id: id(),
    organizationId: organizationId(),
    invoiceId: text('invoice_id').notNull(),
    chargeId: text('charge_id').notNull(),
    // The days interest ran: the day after the due date through the day it was paid.
    fromDate: text('from_date').notNull(),
    toDate: text('to_date').notNull(),
    days: integer('days').notNull(),
    amountOre: integer('amount_ore').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('late_interest', t),
    sameCompany(t, t.invoiceId, invoice),
    sameCompany(t, t.chargeId, charge).onDelete('cascade'),
    uniqueIndex('late_interest_invoice_uq').on(t.invoiceId),
  ],
)

export const lateInterestRelations = relations(lateInterest, ({ one }) => ({
  invoice: one(invoice, { fields: [lateInterest.invoiceId], references: [invoice.id] }),
  charge: one(charge, { fields: [lateInterest.chargeId], references: [charge.id] }),
}))

// A SIE file someone downloaded: which period, how many vouchers. Exporting a period again is
// allowed, but warned about, since importing the same vouchers twice duplicates them.
export const bookkeepingExport = sqliteTable(
  'bookkeeping_export',
  {
    id: id(),
    organizationId: organizationId(),
    fromDate: text('from_date').notNull(),
    toDate: text('to_date').notNull(),
    voucherCount: integer('voucher_count').notNull(),
    exportedByUserId: text('exported_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('bookkeeping_export', t),
    index('bookkeeping_export_org_idx').on(t.organizationId, t.createdAt),
  ],
)

/** One uploaded bank file (camt.054). */
export const paymentImport = sqliteTable(
  'payment_import',
  {
    id: id(),
    organizationId: organizationId(),
    fileName: text('file_name').notNull(),
    messageId: text('message_id'),
    importedByUserId: text('imported_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    paymentCount: integer('payment_count').notNull(),
    duplicateCount: integer('duplicate_count').notNull(),
    totalOre: integer('total_ore').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('payment_import', t),
    index('payment_import_org_idx').on(t.organizationId, t.createdAt),
  ],
)

// Incoming payments are accounting records like invoices: never deleted, only re-classified.
export const payment = sqliteTable(
  'payment',
  {
    id: id(),
    organizationId: organizationId(),
    importId: text('import_id').notNull(),
    // The bank's own id for the transaction; a payment is imported at most once.
    bankReference: text('bank_reference').notNull(),
    bookingDate: text('booking_date').notNull(),
    amountOre: integer('amount_ore').notNull(),
    reference: text('reference'),
    payerName: text('payer_name'),
    status: text('status', { enum: paymentStatuses }).notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  // Which avier a payment settled is in the ledger: its allocation postings.
  (t) => [
    companyKey('payment', t),
    sameCompany(t, t.importId, paymentImport),
    uniqueIndex('payment_org_bank_reference_uq').on(t.organizationId, t.bankReference),
    index('payment_org_status_idx').on(t.organizationId, t.status),
  ],
)

export const paymentImportRelations = relations(paymentImport, ({ many }) => ({
  payments: many(payment),
}))

export const paymentRelations = relations(payment, ({ one }) => ({
  import: one(paymentImport, { fields: [payment.importId], references: [paymentImport.id] }),
}))

// The receivables ledger (kundreskontra): what is owed, paid, credited and paid back, as
// postings (verifikationer) of entries that always balance. Nothing is updated or deleted; an
// undo or a void is a reversing posting. Rules in `features/ledger/postings.ts`.
export const posting = sqliteTable(
  'posting',
  {
    id: id(),
    organizationId: organizationId(),
    // Bokföringsdatum.
    date: text('date').notNull(),
    kind: text('kind', { enum: postingKinds }).notNull(),
    description: text('description').notNull(),
    // The document or payment it records.
    invoiceId: text('invoice_id'),
    creditNoteId: text('credit_note_id'),
    paymentId: text('payment_id'),
    // Set on a reversal; a posting is reversed at most once.
    reversesPostingId: text('reverses_posting_id'),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('posting', t),
    sameCompany(t, t.invoiceId, invoice),
    sameCompany(t, t.creditNoteId, creditNote),
    sameCompany(t, t.paymentId, payment),
    sameCompany(t, t.reversesPostingId, t),
    index('posting_org_date_idx').on(t.organizationId, t.date),
    uniqueIndex('posting_reverses_uq')
      .on(t.reversesPostingId)
      .where(sql`${t.reversesPostingId} is not null`),
  ],
)

export const ledgerEntry = sqliteTable(
  'ledger_entry',
  {
    id: id(),
    organizationId: organizationId(),
    postingId: text('posting_id').notNull(),
    account: text('account', { enum: ledgerAccounts }).notNull(),
    // Debit positive, credit negative.
    amountOre: integer('amount_ore').notNull(),
    // Whose receivable, and which open item: an avi, or none for a party's credit balance.
    partyId: text('party_id'),
    agreementId: text('agreement_id'),
    invoiceId: text('invoice_id'),
    paymentId: text('payment_id'),
    // For income and VAT: what it is for, so bookkeeping can choose accounts.
    chargeKind: text('charge_kind', { enum: chargeKinds }),
    vatRatePercent: integer('vat_rate_percent'),
  },
  (t) => [
    companyKey('ledger_entry', t),
    sameCompany(t, t.postingId, posting),
    sameCompany(t, t.partyId, party),
    sameCompany(t, t.agreementId, agreement),
    sameCompany(t, t.invoiceId, invoice),
    sameCompany(t, t.paymentId, payment),
    index('ledger_entry_posting_idx').on(t.postingId),
    index('ledger_entry_org_invoice_idx').on(t.organizationId, t.invoiceId),
    index('ledger_entry_org_payment_idx').on(t.organizationId, t.paymentId),
    index('ledger_entry_org_party_idx').on(t.organizationId, t.partyId),
  ],
)

export const postingRelations = relations(posting, ({ many }) => ({
  entries: many(ledgerEntry),
}))

export const ledgerEntryRelations = relations(ledgerEntry, ({ one }) => ({
  posting: one(posting, { fields: [ledgerEntry.postingId], references: [posting.id] }),
  invoice: one(invoice, { fields: [ledgerEntry.invoiceId], references: [invoice.id] }),
  payment: one(payment, { fields: [ledgerEntry.paymentId], references: [payment.id] }),
}))

/** A claimed request is never executed twice, including after a worker/network failure. */
export const submission = sqliteTable(
  'submission',
  {
    organizationId: organizationId(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    requestId: text('request_id').notNull(),
    payload: text('payload').notNull(),
    result: text('result'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId, t.operation, t.requestId] })],
)

// --- Management between companies. These tables belong to two companies at once (the managing
// and the managed one), so they reference `organization` directly and are read with `query` and
// explicit filters on both columns, never through `orgQuery`.

/**
 * The managed company lets the managing company work in its data, with raw permissions
 * (`Grant` in `src/lib/managed-access.ts`). Never deleted: revoking sets `revokedAt`, and a later
 * grant between the same companies is a new row.
 */
export const managementGrant = sqliteTable(
  'management_grant',
  {
    id: id(),
    managedOrganizationId: text('managed_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    managingOrganizationId: text('managing_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** JSON, e.g. {"lease":["read","manage"]}. Read through `cleanGrant`. */
    permissions: text('permissions').notNull(),
    requestId: text('request_id').references(() => managementRequest.id),
    grantedBy: text('granted_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('management_grant_active_uq')
      .on(t.managedOrganizationId, t.managingOrganizationId)
      .where(sql`${t.revokedAt} is null`),
    index('management_grant_managing_idx').on(t.managingOrganizationId),
  ],
)

/**
 * The managing company assigns its staff to a company it manages, optionally with a role there.
 * Keyed by the two companies, not by a grant, so assignments come back if access is granted again.
 */
export const managementAssignment = sqliteTable(
  'management_assignment',
  {
    id: id(),
    managingOrganizationId: text('managing_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    managedOrganizationId: text('managed_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * `admin`, `member`, `viewer` or one of the managing company's custom roles; null uses the
     * person's role in their own company.
     */
    role: text('role'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('management_assignment_uq').on(
      t.managingOrganizationId,
      t.managedOrganizationId,
      t.userId,
    ),
  ],
)

/**
 * A managing company asks for access. Its code (shown once, sent by email or by hand) is stored
 * only as a hash; the managed company's owner enters it and decides the permissions.
 */
export const managementRequest = sqliteTable(
  'management_request',
  {
    id: id(),
    managingOrganizationId: text('managing_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** The manager's own name for the client, e.g. "Brf Eken". */
    label: text('label').notNull(),
    email: text('email'),
    /** What the manager asks for (JSON); the managed company decides. */
    permissions: text('permissions').notNull(),
    codeHash: text('code_hash').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    usedByOrganizationId: text('used_by_organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    withdrawnAt: integer('withdrawn_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('management_request_managing_idx').on(t.managingOrganizationId, t.createdAt)],
)

/** Failed attempts to enter a request code, so codes can't be guessed. */
export const managementCodeAttempt = sqliteTable(
  'management_code_attempt',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [index('management_code_attempt_user_idx').on(t.userId, t.createdAt)],
)

/**
 * Who changed what in a company: one row per successful write, recorded by `runApp`
 * (`features/audit`). The actor's own company is kept, so the company sees what a manager's staff
 * did. The entity is a plain id, not a reference, so history outlives deleted records.
 */
export const auditEvent = sqliteTable(
  'audit_event',
  {
    id: id(),
    organizationId: organizationId(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** The user's name when it happened, so the log reads the same after they leave. */
    userName: text('user_name').notNull(),
    actorOrganizationId: text('actor_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    actorOrganizationName: text('actor_organization_name').notNull(),
    /** An `AuditAction`, e.g. "invoice.void". */
    action: text('action').notNull(),
    entityId: text('entity_id'),
    /**
     * JSON of plain values (never text in a language), for what the id alone doesn't say:
     * e.g. a team change's {"name":"Anna","role":"admin","previousRole":"member"}.
     */
    details: text('details'),
    /** The admin acting as `userId` (impersonation), if one was. */
    impersonatedById: text('impersonated_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    impersonatedByName: text('impersonated_by_name'),
    /**
     * A write from Mina sidor: the party the tenant or member acted as (then there is no actor
     * company, and `actorOrganizationName` holds the party's name). No foreign key, so the log
     * never stops a party being deleted.
     */
    actorPartyId: text('actor_party_id'),
    createdAt: createdAt(),
  },
  (t) => [
    companyKey('audit_event', t),
    index('audit_event_org_created_idx').on(t.organizationId, t.createdAt),
  ],
)

// The tenant and member portal ("Mina sidor", `features/portal`). Portal users are never
// organization members: what they may see comes from these links between a user and a party.

/**
 * A user's access to a party's pages in the portal. Never deleted: revoking closes it, and the
 * history stays. One open link per party and user.
 */
export const partyAccess = sqliteTable(
  'party_access',
  {
    id: id(),
    organizationId: organizationId(),
    partyId: text('party_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The invitation it came from. */
    invitationId: text('invitation_id'),
    createdAt: createdAt(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    companyKey('party_access', t),
    sameCompany(t, t.partyId, party).onDelete('cascade'),
    uniqueIndex('party_access_open_uq').on(t.partyId, t.userId).where(sql`${t.revokedAt} is null`),
    index('party_access_user_idx').on(t.userId),
  ],
)

/**
 * An invitation to the portal for one party, sent by staff to an email address. The link carries
 * a random code stored only as a SHA-256 hash; it works until `expiresAt`, once.
 */
export const portalInvitation = sqliteTable(
  'portal_invitation',
  {
    id: id(),
    organizationId: organizationId(),
    partyId: text('party_id').notNull(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    acceptedBy: text('accepted_by').references(() => user.id, { onDelete: 'set null' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    companyKey('portal_invitation', t),
    sameCompany(t, t.partyId, party).onDelete('cascade'),
    index('portal_invitation_party_idx').on(t.organizationId, t.partyId),
  ],
)

// What admins did in the admin dashboard (`features/admin`): impersonations, bans, roles and tiers
// set by agreement. Not company data: it names any user or company, and only admins read it.
export const adminEvent = sqliteTable(
  'admin_event',
  {
    id: id(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** The admin's name when it happened. */
    actorName: text('actor_name').notNull(),
    /** An `AdminAction`, e.g. "impersonate". */
    action: text('action').notNull(),
    targetUserId: text('target_user_id').references(() => user.id, { onDelete: 'set null' }),
    targetOrganizationId: text('target_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    /** JSON of plain values, e.g. {"reason":"…","tier":"brf_plus"}. */
    details: text('details'),
    createdAt: createdAt(),
  },
  (t) => [index('admin_event_created_idx').on(t.createdAt)],
)

export const partyAccessRelations = relations(partyAccess, ({ one }) => ({
  party: one(party, { fields: [partyAccess.partyId], references: [party.id] }),
  user: one(user, { fields: [partyAccess.userId], references: [user.id] }),
}))

export const portalInvitationRelations = relations(portalInvitation, ({ one }) => ({
  party: one(party, { fields: [portalInvitation.partyId], references: [party.id] }),
}))
