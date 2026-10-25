// Fills the LOCAL D1 database with a small, realistic company for development:
// `bun run db:seed` (into an empty database) or `bun run db:reset` (wipe, migrate, seed).
//
// It writes through Wrangler's local D1 binding, the same SQLite file `bun run dev` uses, with the
// app's own schema and invoicing rules. Dates are relative to today, so the data stays current.
// Every name, address and number is made up; numbers only pass their checksums.

import { hashPassword } from 'better-auth/crypto'
import { count, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import * as schema from '#/db/schema'
import { draftCreditNote } from '#/features/invoicing/credit'
import {
  dueDate,
  formatBankgiro,
  invoicePeriod,
  ocrFor,
  rentForPeriod,
  rentLineDescription,
  VAT_RATE_PERCENT,
  vatFor,
} from '#/features/invoicing/rules'
import { earliestMoveOutDate, type LeaseTerms } from '#/features/leases/terms'
import type { UnitKind } from '#/features/properties/unit-kinds'
import { formatOrganizationNumber } from '#/features/tenants/organization-number'
import { addDays, addMonths, stockholmDate } from '#/lib/dates'
import { luhnCheckDigit } from '#/lib/luhn'
import { SEED_PASSWORD, SEED_USERS } from './db-seed-constants'

const withCheckDigit = (base: string) => `${base}${luhnCheckDigit(base)}`
const id = () => crypto.randomUUID()

const { env, dispose } = await getPlatformProxy<Env>()
const db = drizzle(env.DB, { schema })

try {
  const [{ users }] = await db.select({ users: count() }).from(schema.user)
  if (users > 0) {
    console.error('The local database already has data. Run `bun run db:reset` to start over.')
    process.exitCode = 1
  } else {
    await seed()
  }
} finally {
  await dispose()
}

async function seed() {
  const today = stockholmDate(Date.now())
  const thisMonth = `${today.slice(0, 7)}-01`
  const year = Number(today.slice(0, 4))
  const now = new Date()

  // --- Logins: an owner and a member, already verified so they can sign in straight away.
  const password = await hashPassword(SEED_PASSWORD)
  const owner = { id: id(), ...SEED_USERS.owner }
  const member = { id: id(), ...SEED_USERS.member }
  for (const u of [owner, member]) {
    await db
      .insert(schema.user)
      .values({ ...u, emailVerified: true, createdAt: now, updatedAt: now })
    await db.insert(schema.account).values({
      id: id(),
      accountId: u.id,
      providerId: 'credential',
      userId: u.id,
      password,
      createdAt: now,
      updatedAt: now,
    })
  }

  // --- The company, its members and the seller details invoices need.
  const org = { id: id(), name: 'Exempel Fastigheter AB', slug: 'exempel-fastigheter' }
  await db.insert(schema.organization).values({ ...org, createdAt: now })
  await db.insert(schema.member).values([
    { id: id(), organizationId: org.id, userId: owner.id, role: 'owner', createdAt: now },
    { id: id(), organizationId: org.id, userId: member.id, role: 'member', createdAt: now },
  ])
  const settings = {
    organizationNumber: formatOrganizationNumber(withCheckDigit('559900000')),
    bankgiro: formatBankgiro(withCheckDigit('990000')),
  }
  await db.insert(schema.organizationSettings).values({
    organizationId: org.id,
    ...settings,
    streetAddress: 'Exempelgatan 1',
    postalCode: '75320',
    city: 'Uppsala',
    email: 'hyra@fastighet.test',
    phone: '018-00 00 00',
    fSkatt: true,
  })

  // --- Two properties. Units 1102, P2 and F1 stay vacant.
  const orgId = org.id
  const larkan = { id: id(), designation: 'Uppsala Kungsängen 12:3', name: 'Kv. Lärkan' }
  const falken = { id: id(), designation: 'Uppsala Fålhagen 4:7', name: 'Kv. Falken' }
  await db.insert(schema.property).values([
    {
      ...larkan,
      organizationId: orgId,
      streetAddress: 'Kungsgatan 12',
      postalCode: '75321',
      city: 'Uppsala',
    },
    {
      ...falken,
      organizationId: orgId,
      streetAddress: 'Fålhagsleden 4',
      postalCode: '75323',
      city: 'Uppsala',
    },
  ])
  const unit = (
    property: typeof larkan,
    kind: UnitKind,
    label: string,
    areaSqm: number | null,
  ) => ({
    id: id(),
    organizationId: orgId,
    propertyId: property.id,
    designation: property.designation,
    kind,
    label,
    areaSqm,
  })
  const units = {
    apt1001: unit(larkan, 'apartment', '1001', 72.5),
    apt1002: unit(larkan, 'apartment', '1002', 58),
    shop2001: unit(larkan, 'commercial', '2001', 120),
    parkP1: unit(larkan, 'parking', 'P1', null),
    parkP2: unit(larkan, 'parking', 'P2', null),
    apt1101: unit(falken, 'apartment', '1101', 81),
    apt1102: unit(falken, 'apartment', '1102', 64.5),
    storeF1: unit(falken, 'storage', 'F1', 6),
  }
  await db.insert(schema.unit).values(Object.values(units).map(({ designation: _, ...u }) => u))

  // --- Tenants: three people (one without email) and a company.
  const tenant = (
    kind: 'person' | 'company',
    name: string,
    email: string | null,
    organizationNumber: string | null = null,
  ) => ({
    id: id(),
    organizationId: orgId,
    kind,
    name,
    organizationNumber,
    email,
    phone: null,
    streetAddress: 'Kungsgatan 12',
    postalCode: '75321',
    city: 'Uppsala',
  })
  const anna = tenant('person', 'Anna Svensson', 'anna.svensson@hyresgast.test')
  const erik = tenant('person', 'Erik Lindqvist', 'erik.lindqvist@hyresgast.test')
  const sara = {
    ...tenant('person', 'Sara Holm', null),
    streetAddress: 'Fålhagsleden 4',
    postalCode: '75323',
  }
  const cafe = tenant(
    'company',
    'Kaffe & Kaka AB',
    'ekonomi@kaffeochkaka.test',
    formatOrganizationNumber(withCheckDigit('559900001')),
  )
  await db.insert(schema.tenant).values([anna, erik, sara, cafe])

  // --- Leases: one of each kind the app handles.
  const openEnded = {
    endDate: null,
    extensionMonths: null,
    noticePeriodMonths: 3,
    moveOutDate: null,
  } as const
  const erikTerms: LeaseTerms = { ...openEnded, startDate: addMonths(thisMonth, -30) }
  const erikNotice = addMonths(today, -1)
  const leases = [
    // Open-ended apartment, monthly rent. Gets the seeded invoice below.
    {
      key: 'anna',
      tenant: anna,
      units: [units.apt1001],
      terms: { ...openEnded, startDate: addMonths(thisMonth, -14) },
      rentOre: 845000,
      rentInterval: 'monthly' as const,
      invoiceInterval: 'monthly' as const,
      vat: false,
    },
    // Commercial premises and parking: three-year term extended by three years, yearly rent
    // invoiced per quarter, with VAT.
    {
      key: 'cafe',
      tenant: cafe,
      units: [units.shop2001, units.parkP1],
      terms: {
        startDate: `${year - 2}-01-01`,
        endDate: `${year}-12-31`,
        extensionMonths: 36,
        noticePeriodMonths: 9,
        moveOutDate: null,
      },
      rentOre: 18000000,
      rentInterval: 'yearly' as const,
      invoiceInterval: 'quarterly' as const,
      vat: true,
    },
    // Terminated a month ago, moving out at the earliest date the lease allows.
    {
      key: 'erik',
      tenant: erik,
      units: [units.apt1002],
      terms: { ...erikTerms, moveOutDate: earliestMoveOutDate(erikTerms, erikNotice) },
      noticeDate: erikNotice,
      rentOre: 720000,
      rentInterval: 'monthly' as const,
      invoiceInterval: 'monthly' as const,
      vat: false,
    },
    // Moves in next month; the tenant has no email, so their notices are printed.
    {
      key: 'sara',
      tenant: sara,
      units: [units.apt1101],
      terms: { ...openEnded, startDate: addMonths(thisMonth, 1) },
      rentOre: 690000,
      rentInterval: 'monthly' as const,
      invoiceInterval: 'monthly' as const,
      vat: false,
    },
  ]
  const leaseIds: Record<string, string> = {}
  for (const [i, l] of leases.entries()) {
    const leaseId = id()
    leaseIds[l.key] = leaseId
    await db.insert(schema.lease).values({
      id: leaseId,
      organizationId: orgId,
      number: i + 1,
      tenantId: l.tenant.id,
      ...l.terms,
      noticeDate: 'noticeDate' in l ? l.noticeDate : null,
      rentOre: l.rentOre,
      rentInterval: l.rentInterval,
      invoiceInterval: l.invoiceInterval,
      vat: l.vat,
    })
    await db
      .insert(schema.leaseUnit)
      .values(l.units.map((u) => ({ leaseId, unitId: u.id, organizationId: orgId })))
  }

  // --- One invoice: Anna's rent for this month, issued and emailed 20 days before the month
  // started and still unpaid, so it shows as overdue. Built with the same rules as invoice runs.
  const annaLease = leases[0]
  const period = invoicePeriod(today.slice(0, 7), 'monthly')
  if (!period) throw new Error('monthly invoicing always has a period')
  const issueDate = addDays(thisMonth, -20)
  const netOre = rentForPeriod({ ...annaLease.terms, ...annaLease }, period)
  const vatOre = vatFor(netOre, annaLease.vat)
  const invoiceId = id()
  await db.insert(schema.invoice).values({
    id: invoiceId,
    organizationId: orgId,
    number: 1,
    ocr: ocrFor(1),
    leaseId: leaseIds.anna,
    tenantId: anna.id,
    recipientName: anna.name,
    recipientStreetAddress: anna.streetAddress,
    recipientPostalCode: anna.postalCode,
    recipientCity: anna.city,
    recipientEmail: anna.email,
    periodStart: period.start,
    periodEnd: period.end,
    issueDate,
    dueDate: dueDate(period, issueDate),
    netOre,
    vatOre,
    totalOre: netOre + vatOre,
    sentAt: new Date(`${issueDate}T08:00:00Z`),
  })
  await db.insert(schema.invoiceLine).values({
    invoiceId,
    organizationId: orgId,
    position: 1,
    description: rentLineDescription(annaLease.units, period),
    netOre,
    vatRatePercent: vatOre > 0 ? VAT_RATE_PERCENT : 0,
    vatOre,
  })

  // --- A credit note on that invoice: a 1 000 kr rent reduction, issued five days ago. Built
  // with the same rule as "Kreditera", so Anna still owes the rest.
  const credit = draftCreditNote(
    {
      number: 1,
      totalOre: netOre + vatOre,
      creditedOre: 0,
      voidedAt: null,
      lines: [
        { description: '', netOre, vatRatePercent: vatOre > 0 ? VAT_RATE_PERCENT : 0, vatOre },
      ],
    },
    { kind: 'amount', netOre: 100_000 },
  )
  if (!credit.ok) throw new Error(`seed credit note: ${credit.problem}`)
  const creditNoteId = id()
  await db.insert(schema.creditNote).values({
    id: creditNoteId,
    organizationId: orgId,
    number: 1,
    invoiceId,
    reason: 'Hyresreduktion för trasig diskmaskin',
    recipientName: anna.name,
    recipientStreetAddress: anna.streetAddress,
    recipientPostalCode: anna.postalCode,
    recipientCity: anna.city,
    recipientEmail: anna.email,
    issueDate: addDays(today, -5),
    netOre: credit.draft.netOre,
    vatOre: credit.draft.vatOre,
    totalOre: credit.draft.totalOre,
  })
  await db.insert(schema.creditNoteLine).values(
    credit.draft.lines.map((line, index) => ({
      creditNoteId,
      organizationId: orgId,
      position: index + 1,
      ...line,
    })),
  )
  await db
    .update(schema.invoice)
    .set({ creditedOre: credit.draft.totalOre })
    .where(eq(schema.invoice.id, invoiceId))

  console.log(`Seeded ${org.name}:
  logins     ${owner.email} (owner), ${member.email} (member). Password: SEED_PASSWORD in scripts/db-seed-constants.ts
  bankgiro   ${settings.bankgiro}, org.nr ${settings.organizationNumber}
  data       2 properties, ${Object.keys(units).length} units, 4 tenants, ${leases.length} leases
  invoice    #1 to ${anna.name} for ${period.start.slice(0, 7)}, due ${dueDate(period, issueDate)}
  credit     kreditfaktura 1 on invoice #1, ${credit.draft.totalOre / 100} kr`)
}
