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
import { unitKinds } from '#/features/properties/unit-kinds'
import { organization } from './auth-schema'

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

export const tenantRelations = relations(tenant, ({ many }) => ({ leases: many(lease) }))

export const leaseRelations = relations(lease, ({ one, many }) => ({
  tenant: one(tenant, { fields: [lease.tenantId], references: [tenant.id] }),
  units: many(leaseUnit),
}))

export const leaseUnitRelations = relations(leaseUnit, ({ one }) => ({
  lease: one(lease, { fields: [leaseUnit.leaseId], references: [lease.id] }),
  unit: one(unit, { fields: [leaseUnit.unitId], references: [unit.id] }),
}))
