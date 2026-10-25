import { relations, sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { agreementKinds, partyRoles } from '#/features/agreements/kinds'
import { invoiceIntervals, rentIntervals, tenantKinds } from '#/features/leases/options'
import { paymentStatuses } from '#/features/payments/matching'
import { unitKinds } from '#/features/properties/unit-kinds'
import { companyKinds } from '#/features/settings/company-kinds'
import { organization, user } from './auth-schema'

export * from './auth-schema'

// Every domain table carries `organizationId` (the customer company) and every query filters on
// it — SQLite has no row-level security, so tenant isolation lives in `src/server/scoped.ts`.
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
  (t) => [uniqueIndex('property_org_designation_uq').on(t.organizationId, t.designation)],
)

export const unit = sqliteTable(
  'unit',
  {
    id: id(),
    organizationId: organizationId(),
    propertyId: text('property_id')
      .notNull()
      .references(() => property.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: unitKinds }).notNull(),
    // Objektsnummer as printed on contracts and rent notices.
    label: text('label').notNull(),
    areaSqm: real('area_sqm'),
    rooms: integer('rooms'),
    floor: integer('floor'),
    createdAt: createdAt(),
  },
  (t) => [
    index('unit_org_property_idx').on(t.organizationId, t.propertyId),
    uniqueIndex('unit_property_label_uq').on(t.propertyId, t.label),
  ],
)

export const tenant = sqliteTable(
  'tenant',
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
  (t) => [index('tenant_org_name_idx').on(t.organizationId, t.name)],
)

// An agreement is what a run invoices: a lease (hyresavtal) or a bostadsrätt. It holds what
// billing needs; lease-only and ownership-only details live in their own tables. Parties are the
// tenants or owners on it (`agreementParty`).
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
    rentOre: integer('rent_ore').notNull(),
    rentInterval: text('rent_interval', { enum: rentIntervals }).notNull(),
    invoiceInterval: text('invoice_interval', { enum: invoiceIntervals }).notNull(),
    // Rent is subject to VAT (frivillig skattskyldighet for commercial premises).
    vat: integer('vat', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('agreement_org_number_uq').on(t.organizationId, t.number)],
)

export const agreementUnit = sqliteTable(
  'agreement_unit',
  {
    agreementId: text('agreement_id')
      .notNull()
      .references(() => agreement.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => unit.id),
    organizationId: organizationId(),
  },
  (t) => [
    primaryKey({ columns: [t.agreementId, t.unitId] }),
    index('agreement_unit_unit_idx').on(t.unitId),
  ],
)

// The tenants (or owners) on an agreement. Exactly one receives the invoices; the invoice copies
// the names of all of them and that party's address.
export const agreementParty = sqliteTable(
  'agreement_party',
  {
    agreementId: text('agreement_id')
      .notNull()
      .references(() => agreement.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id),
    organizationId: organizationId(),
    role: text('role', { enum: partyRoles }).notNull(),
    // Ownership share in percent, for co-owners of a bostadsrätt.
    sharePercent: integer('share_percent'),
    receivesInvoices: integer('receives_invoices', { mode: 'boolean' }).notNull().default(false),
    // Order on documents: the first party is named first.
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agreementId, t.tenantId] }),
    index('agreement_party_org_tenant_idx').on(t.organizationId, t.tenantId),
  ],
)

// A lease's own terms. `agreement.endDate` is derived from them and written in the same batch.
export const leaseTerms = sqliteTable('lease_terms', {
  agreementId: text('agreement_id')
    .primaryKey()
    .references(() => agreement.id, { onDelete: 'cascade' }),
  organizationId: organizationId(),
  // Set for a fixed-term lease (tidsbestämt); null for an open-ended one (tillsvidare).
  termEndDate: text('term_end_date'),
  extensionMonths: integer('extension_months'),
  noticePeriodMonths: integer('notice_period_months').notNull(),
  noticeDate: text('notice_date'),
  moveOutDate: text('move_out_date'),
})

// A bostadsrätt's own details. Only the basics so far; the BRF registers come later.
export const ownershipTerms = sqliteTable('ownership_terms', {
  agreementId: text('agreement_id')
    .primaryKey()
    .references(() => agreement.id, { onDelete: 'cascade' }),
  organizationId: organizationId(),
  // Andelstal: the apartment's share of the association's fees.
  shareRatio: real('share_ratio'),
  // Insats paid when the right was first granted (upplåtelse).
  depositOre: integer('deposit_ore'),
  grantedOn: text('granted_on'),
  // The sellers' bostadsrätt when this one came from a transfer (överlåtelse).
  previousAgreementId: text('previous_agreement_id').references(
    (): AnySQLiteColumn => agreement.id,
  ),
})

export const propertyRelations = relations(property, ({ many }) => ({ units: many(unit) }))

export const unitRelations = relations(unit, ({ one, many }) => ({
  property: one(property, { fields: [unit.propertyId], references: [property.id] }),
  agreements: many(agreementUnit),
}))

export const tenantRelations = relations(tenant, ({ many }) => ({
  agreements: many(agreementParty),
  invoices: many(invoice),
}))

export const agreementRelations = relations(agreement, ({ one, many }) => ({
  parties: many(agreementParty),
  units: many(agreementUnit),
  leaseTerms: one(leaseTerms),
  ownershipTerms: one(ownershipTerms),
  invoices: many(invoice),
}))

export const agreementUnitRelations = relations(agreementUnit, ({ one }) => ({
  agreement: one(agreement, { fields: [agreementUnit.agreementId], references: [agreement.id] }),
  unit: one(unit, { fields: [agreementUnit.unitId], references: [unit.id] }),
}))

export const agreementPartyRelations = relations(agreementParty, ({ one }) => ({
  agreement: one(agreement, { fields: [agreementParty.agreementId], references: [agreement.id] }),
  tenant: one(tenant, { fields: [agreementParty.tenantId], references: [tenant.id] }),
}))

export const leaseTermsRelations = relations(leaseTerms, ({ one }) => ({
  agreement: one(agreement, { fields: [leaseTerms.agreementId], references: [agreement.id] }),
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
    agreementId: text('agreement_id')
      .notNull()
      .references(() => agreement.id),
    // The party that received the invoice.
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id),
    recipientName: text('recipient_name').notNull(),
    recipientStreetAddress: text('recipient_street_address'),
    recipientPostalCode: text('recipient_postal_code'),
    recipientCity: text('recipient_city'),
    recipientEmail: text('recipient_email'),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    issueDate: text('issue_date').notNull(),
    dueDate: text('due_date').notNull(),
    netOre: integer('net_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    totalOre: integer('total_ore').notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    paidOn: text('paid_on'),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    // Sum of the credit notes issued against this invoice (incl. VAT). Updated in the same batch
    // that creates a credit note; what is still owed is totalOre - creditedOre.
    creditedOre: integer('credited_ore').notNull().default(0),
    // A corrected avi issued for the same lease and period after this one was voided or credited
    // in full points back to the avi it replaces.
    replacesInvoiceId: text('replaces_invoice_id').references((): AnySQLiteColumn => invoice.id),
    createdAt: createdAt(),
  },
  (t) => [
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
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    netOre: integer('net_ore').notNull(),
    vatRatePercent: integer('vat_rate_percent').notNull(),
    vatOre: integer('vat_ore').notNull(),
  },
  (t) => [index('invoice_line_invoice_idx').on(t.invoiceId)],
)

export const invoiceRelations = relations(invoice, ({ one, many }) => ({
  agreement: one(agreement, { fields: [invoice.agreementId], references: [agreement.id] }),
  tenant: one(tenant, { fields: [invoice.tenantId], references: [tenant.id] }),
  lines: many(invoiceLine),
  payments: many(payment),
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
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoice.id),
    reason: text('reason').notNull(),
    recipientName: text('recipient_name').notNull(),
    recipientStreetAddress: text('recipient_street_address'),
    recipientPostalCode: text('recipient_postal_code'),
    recipientCity: text('recipient_city'),
    recipientEmail: text('recipient_email'),
    issueDate: text('issue_date').notNull(),
    netOre: integer('net_ore').notNull(),
    vatOre: integer('vat_ore').notNull(),
    totalOre: integer('total_ore').notNull(),
    // True when the invoice was already paid when it was credited: the amount is paid back to the
    // tenant instead of lowering what is owed. `refundedOn` records when that was done.
    refund: integer('refund', { mode: 'boolean' }).notNull().default(false),
    refundedOn: text('refunded_on'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('credit_note_org_number_uq').on(t.organizationId, t.number),
    index('credit_note_invoice_idx').on(t.invoiceId),
  ],
)

export const creditNoteLine = sqliteTable(
  'credit_note_line',
  {
    id: id(),
    creditNoteId: text('credit_note_id')
      .notNull()
      .references(() => creditNote.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    netOre: integer('net_ore').notNull(),
    vatRatePercent: integer('vat_rate_percent').notNull(),
    vatOre: integer('vat_ore').notNull(),
  },
  (t) => [index('credit_note_line_note_idx').on(t.creditNoteId)],
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
  (t) => [index('payment_import_org_idx').on(t.organizationId, t.createdAt)],
)

// Incoming payments are accounting records like invoices: never deleted, only re-classified.
export const payment = sqliteTable(
  'payment',
  {
    id: id(),
    organizationId: organizationId(),
    importId: text('import_id')
      .notNull()
      .references(() => paymentImport.id),
    // The bank's own id for the transaction; a payment is imported at most once.
    bankReference: text('bank_reference').notNull(),
    bookingDate: text('booking_date').notNull(),
    amountOre: integer('amount_ore').notNull(),
    reference: text('reference'),
    payerName: text('payer_name'),
    status: text('status', { enum: paymentStatuses }).notNull(),
    note: text('note'),
    invoiceId: text('invoice_id').references(() => invoice.id),
    // True when this payment is what marked the invoice paid, so undoing it can reopen the invoice.
    marksInvoicePaid: integer('marks_invoice_paid', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payment_org_bank_reference_uq').on(t.organizationId, t.bankReference),
    index('payment_org_status_idx').on(t.organizationId, t.status),
    index('payment_invoice_idx').on(t.invoiceId),
  ],
)

export const paymentImportRelations = relations(paymentImport, ({ many }) => ({
  payments: many(payment),
}))

export const paymentRelations = relations(payment, ({ one }) => ({
  import: one(paymentImport, { fields: [payment.importId], references: [paymentImport.id] }),
  invoice: one(invoice, { fields: [payment.invoiceId], references: [invoice.id] }),
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
