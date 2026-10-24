import { relations, sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { invoiceIntervals, rentIntervals, tenantKinds } from '#/features/leases/options'
import { paymentStatuses } from '#/features/payments/matching'
import { unitKinds } from '#/features/properties/unit-kinds'
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

export const lease = sqliteTable(
  'lease',
  {
    id: id(),
    organizationId: organizationId(),
    // Avtalsnummer, sequential per organization.
    number: integer('number').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    extensionMonths: integer('extension_months'),
    noticePeriodMonths: integer('notice_period_months').notNull(),
    rentOre: integer('rent_ore').notNull(),
    rentInterval: text('rent_interval', { enum: rentIntervals }).notNull(),
    invoiceInterval: text('invoice_interval', { enum: invoiceIntervals }).notNull(),
    // Rent is subject to VAT (frivillig skattskyldighet for commercial premises).
    vat: integer('vat', { mode: 'boolean' }).notNull().default(false),
    noticeDate: text('notice_date'),
    moveOutDate: text('move_out_date'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('lease_org_number_uq').on(t.organizationId, t.number),
    index('lease_org_tenant_idx').on(t.organizationId, t.tenantId),
  ],
)

export const leaseUnit = sqliteTable(
  'lease_unit',
  {
    leaseId: text('lease_id')
      .notNull()
      .references(() => lease.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => unit.id),
    organizationId: organizationId(),
  },
  (t) => [
    primaryKey({ columns: [t.leaseId, t.unitId] }),
    index('lease_unit_unit_idx').on(t.unitId),
  ],
)

export const propertyRelations = relations(property, ({ many }) => ({ units: many(unit) }))

export const unitRelations = relations(unit, ({ one, many }) => ({
  property: one(property, { fields: [unit.propertyId], references: [property.id] }),
  leases: many(leaseUnit),
}))

export const tenantRelations = relations(tenant, ({ many }) => ({
  leases: many(lease),
  invoices: many(invoice),
}))

export const leaseRelations = relations(lease, ({ one, many }) => ({
  tenant: one(tenant, { fields: [lease.tenantId], references: [tenant.id] }),
  units: many(leaseUnit),
  invoices: many(invoice),
}))

export const leaseUnitRelations = relations(leaseUnit, ({ one }) => ({
  lease: one(lease, { fields: [leaseUnit.leaseId], references: [lease.id] }),
  unit: one(unit, { fields: [leaseUnit.unitId], references: [unit.id] }),
}))

/** Seller details printed on invoices. One row per organization, created on first save. */
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
    leaseId: text('lease_id')
      .notNull()
      .references(() => lease.id),
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
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoice_org_number_uq').on(t.organizationId, t.number),
    // A lease is invoiced at most once per period, which makes invoice runs safe to repeat.
    uniqueIndex('invoice_lease_period_uq').on(t.leaseId, t.periodStart),
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
  lease: one(lease, { fields: [invoice.leaseId], references: [lease.id] }),
  tenant: one(tenant, { fields: [invoice.tenantId], references: [tenant.id] }),
  lines: many(invoiceLine),
  payments: many(payment),
}))

export const invoiceLineRelations = relations(invoiceLine, ({ one }) => ({
  invoice: one(invoice, { fields: [invoiceLine.invoiceId], references: [invoice.id] }),
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
