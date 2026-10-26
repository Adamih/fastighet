// Fills the LOCAL D1 database with a realistic small company for development:
// `bun run db:seed` (into an empty database) or `bun run db:reset` (wipe, migrate, seed).
//
// It writes through Wrangler's local D1 binding, the same SQLite file `bun run dev` uses, with the
// app's own schema and rules: invoices come from simulated monthly invoice runs (the same period,
// rent, VAT and due-date rules as "Skapa avier"), payments from weekly bank files, credit notes
// from the "Kreditera" rule. Dates are relative to today, so the data stays current, and a fixed
// random seed keeps every run identical. Every name, address and number is made up; numbers
// only pass their checksums.

import { hashPassword } from 'better-auth/crypto'
import { and, count, eq, getTableColumns, gte, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import * as schema from '#/db/schema'
import { type BillableAgreement, billFor } from '#/features/agreements/billing'
import type { Charge, InvoiceLineDraft } from '#/features/agreements/charges'
import { equalShares, type Party } from '#/features/agreements/parties'
import {
  adjustmentDate,
  defaultBaseMonth,
  indexSupplement,
  kpiMonthFor,
  perYear,
} from '#/features/indexation/rules'
import { type CreditRequest, draftCreditNote } from '#/features/invoicing/credit'
import {
  dueDate,
  formatBankgiro,
  type InvoiceInterval,
  invoicePeriod,
  ocrFor,
  type Period,
} from '#/features/invoicing/rules'
import { earliestMoveOutDate, effectiveEndDate, type LeaseTerms } from '#/features/leases/terms'
import {
  allocationEntries,
  creditNoteEntries,
  type EntryDraft,
  invoiceEntries,
  paymentEntries,
  refundEntries,
  reminderFeeEntries,
  reversal,
} from '#/features/ledger/postings'
import type { UnitKind } from '#/features/properties/unit-kinds'
import {
  nextReminderOn,
  type ReminderSettings,
  reminderDueDate,
  reminderFee,
} from '#/features/reminders/rules'
import { formatOrganizationNumber } from '#/features/tenants/organization-number'
import { addDays, addMonths, endOfMonth, stockholmDate, weekdayOnOrAfter } from '#/lib/dates'
import { luhnCheckDigit } from '#/lib/luhn'
import { formatSek } from '#/lib/money'
import { SEED_PASSWORD, SEED_USERS } from './db-seed-constants'

/** Seed records are built up step by step, so their fields stay writable. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const withCheckDigit = (base: string) => `${base}${luhnCheckDigit(base)}`
const id = () => crypto.randomUUID()

/** Deterministic pseudo-random numbers (mulberry32), so every seed run looks the same. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Banks book on weekdays: a Saturday or Sunday moves to the Monday after. */
const bankDay = (date: string) => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return weekday === 6 ? addDays(date, 2) : weekday === 0 ? addDays(date, 1) : date
}

const { env, dispose } = await getPlatformProxy<Env>()
const db = drizzle(env.DB, { schema })

/** D1 allows about 100 bound values per statement, so bulk inserts go in chunks. */
async function insertAll<T extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0],
  rows: T[],
) {
  if (rows.length === 0) return
  // Drizzle binds every column of the table in a multi-row insert, defaults included.
  const columns = Object.keys(getTableColumns(table)).length
  const perStatement = Math.max(1, Math.floor(90 / columns))
  for (let i = 0; i < rows.length; i += perStatement) {
    // biome-ignore lint/suspicious/noExplicitAny: one helper for every table's insert type
    await db.insert(table).values(rows.slice(i, i + perStatement) as any)
  }
}

/**
 * Reminders for avier still unpaid today: the first the interval after the due date (with the
 * fee, if one is agreed) and a second one interval later, as "Skicka påminnelse" would.
 */
function seedReminders(
  organizationId: string,
  ledger: ReturnType<typeof seedLedger>,
  invoices: readonly {
    id: string
    number: number
    dueDate: string
    owedOre: number
    recipientEmail: string | null
    partyId: string
    agreementId: string
  }[],
  settings: ReminderSettings,
  today: string,
) {
  const rows: (typeof schema.paymentReminder.$inferInsert)[] = []
  for (const inv of invoices) {
    if (!inv.recipientEmail || inv.owedOre <= 0) continue
    const sent: { sentOn: string; feeOre: number }[] = []
    let owed = inv.owedOre
    // At most two: after that a landlord would hand it to debt collection (not modelled).
    while (sent.length < 2) {
      const on = weekdayOnOrAfter(nextReminderOn(inv.dueDate, sent, settings))
      if (on > today) break
      const feeOre = reminderFee(settings, sent)
      owed += feeOre
      sent.push({ sentOn: on, feeOre })
      rows.push({
        id: id(),
        organizationId,
        invoiceId: inv.id,
        sequence: sent.length,
        sentOn: on,
        dueDate: reminderDueDate(on, settings),
        owedOre: owed,
        feeOre,
        recipientEmail: inv.recipientEmail,
      })
      if (feeOre > 0) {
        ledger.post(
          {
            date: on,
            kind: 'reminder',
            description: `Påminnelseavgift, avi ${inv.number}`,
            invoiceId: inv.id,
          },
          reminderFeeEntries(inv.id, feeOre),
          { partyId: inv.partyId, agreementId: inv.agreementId },
        )
      }
    }
  }
  return rows
}

/**
 * Ledger rows for a seeded company, built with the app's posting rules so the seed's money adds
 * up the same way the app's does. Call `write` once everything is posted.
 */
function seedLedger(organizationId: string) {
  const postings: (typeof schema.posting.$inferInsert)[] = []
  const entries: (typeof schema.ledgerEntry.$inferInsert)[] = []
  const post = (
    draft: Omit<typeof schema.posting.$inferInsert, 'id' | 'organizationId'>,
    drafts: readonly EntryDraft[],
    owner: { partyId: string; agreementId: string } | null = null,
  ) => {
    const postingId = id()
    postings.push({ ...draft, id: postingId, organizationId })
    entries.push(
      ...drafts.map((e) => ({
        ...e,
        id: id(),
        organizationId,
        postingId,
        partyId: e.invoiceId ? (owner?.partyId ?? null) : null,
        agreementId: e.invoiceId ? (owner?.agreementId ?? null) : null,
      })),
    )
    return postingId
  }
  const write = async () => {
    await insertAll(schema.posting, postings)
    await insertAll(schema.ledgerEntry, entries)
  }
  return { post, write }
}

try {
  const [{ users }] = await db.select({ users: count() }).from(schema.user)
  if (users > 0) {
    console.error('The local database already has data. Run `bun run db:reset` to start over.')
    process.exitCode = 1
  } else {
    await seed()
    await seedBrf()
  }
} finally {
  await dispose()
}

async function seed() {
  const today = stockholmDate(Date.now())
  const thisMonth = `${today.slice(0, 7)}-01`
  const year = Number(today.slice(0, 4))
  const now = new Date()
  const rand = random(20261025)
  const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))

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
    // A 60 kr reminder fee is agreed in every lease.
    reminderFeeOre: 6_000,
  })
  const orgId = org.id

  // --- Three properties. A few units stay vacant: Lärkan 1103 and P4, Falken F2, Ugglan 1002
  // and P2.
  const properties = {
    larkan: {
      id: id(),
      designation: 'Uppsala Kungsängen 12:3',
      name: 'Kv. Lärkan',
      streetAddress: 'Kungsgatan 12',
      postalCode: '75321',
    },
    falken: {
      id: id(),
      designation: 'Uppsala Fålhagen 4:7',
      name: 'Kv. Falken',
      streetAddress: 'Fålhagsleden 4',
      postalCode: '75323',
    },
    ugglan: {
      id: id(),
      designation: 'Uppsala Luthagen 21:5',
      name: 'Kv. Ugglan',
      streetAddress: 'Sysslomansgatan 21',
      postalCode: '75311',
    },
  }
  await db
    .insert(schema.property)
    .values(
      Object.values(properties).map((p) => ({ ...p, organizationId: orgId, city: 'Uppsala' })),
    )
  type Property = (typeof properties)[keyof typeof properties]
  const unit = (property: Property, kind: UnitKind, label: string, areaSqm: number | null) => ({
    id: id(),
    organizationId: orgId,
    propertyId: property.id,
    designation: property.designation,
    address: property,
    kind,
    label,
    areaSqm,
  })
  const { larkan, falken, ugglan } = properties
  const units = {
    l1001: unit(larkan, 'apartment', '1001', 72.5),
    l1002: unit(larkan, 'apartment', '1002', 58),
    l1003: unit(larkan, 'apartment', '1003', 41),
    l1101: unit(larkan, 'apartment', '1101', 72.5),
    l1102: unit(larkan, 'apartment', '1102', 58),
    l1103: unit(larkan, 'apartment', '1103', 41),
    l2001: unit(larkan, 'commercial', '2001', 120),
    lP1: unit(larkan, 'parking', 'P1', null),
    lP2: unit(larkan, 'parking', 'P2', null),
    lP3: unit(larkan, 'parking', 'P3', null),
    lP4: unit(larkan, 'parking', 'P4', null),
    f1101: unit(falken, 'apartment', '1101', 81),
    f1102: unit(falken, 'apartment', '1102', 64.5),
    f1201: unit(falken, 'apartment', '1201', 81),
    f1202: unit(falken, 'apartment', '1202', 64.5),
    fF1: unit(falken, 'storage', 'F1', 6),
    fF2: unit(falken, 'storage', 'F2', 4),
    u0101: unit(ugglan, 'commercial', '0101', 85),
    u0102: unit(ugglan, 'commercial', '0102', 140),
    u1001: unit(ugglan, 'apartment', '1001', 68),
    u1002: unit(ugglan, 'apartment', '1002', 52),
    uP1: unit(ugglan, 'parking', 'P1', null),
    uP2: unit(ugglan, 'parking', 'P2', null),
  }
  await insertAll(
    schema.unit,
    Object.values(units).map(({ designation: _, address: __, ...u }) => u),
  )

  // --- Tenants. Most live where they rent; two have no email, so their avier are printed.
  const phone = () =>
    `07${between(0, 6)}-${between(100, 999)} ${between(10, 99)} ${between(10, 99)}`
  type Unit = (typeof units)[keyof typeof units]
  const person = (name: string, email: string | null, home: Unit | Property) => {
    const address = 'address' in home ? home.address : home
    return {
      id: id(),
      organizationId: orgId,
      kind: 'person' as const,
      name,
      organizationNumber: null,
      email,
      phone: phone(),
      streetAddress: address.streetAddress,
      postalCode: address.postalCode,
      city: 'Uppsala',
    }
  }
  const company = (
    name: string,
    orgNumberBase: string,
    email: string,
    address: { streetAddress: string; postalCode: string; city: string },
  ) => ({
    id: id(),
    organizationId: orgId,
    kind: 'company' as const,
    name,
    organizationNumber: formatOrganizationNumber(withCheckDigit(orgNumberBase)),
    email,
    phone: `018-${between(10, 99)} ${between(10, 99)} ${between(10, 99)}`,
    ...address,
  })
  const tenants = {
    johan: person('Johan Berg', 'johan.berg@hyresgast.test', {
      streetAddress: 'Vaksalagatan 30',
      postalCode: '75331',
    } as Property),
    anna: person('Anna Svensson', 'anna.svensson@hyresgast.test', units.l1001),
    erik: person('Erik Lindqvist', 'erik.lindqvist@hyresgast.test', units.l1002),
    fatima: person('Fatima Ali', 'fatima.ali@hyresgast.test', units.l1003),
    mikael: person('Mikael Andersson', 'mikael.andersson@hyresgast.test', units.l1101),
    sofia: person('Sofia Andersson', 'sofia.andersson@hyresgast.test', units.l1101),
    emma: person('Emma Johansson', 'emma.johansson@hyresgast.test', units.l1102),
    lars: person('Lars Nilsson', 'lars.nilsson@hyresgast.test', {
      streetAddress: 'Kungsgatan 18',
      postalCode: '75321',
    } as Property),
    sara: person('Sara Holm', null, units.f1101),
    oskar: person('Oskar Persson', 'oskar.persson@hyresgast.test', units.f1102),
    elin: person('Elin Karlsson', null, units.f1201),
    ahmed: person('Ahmed Hassan', 'ahmed.hassan@hyresgast.test', units.f1202),
    maria: person('Maria Eriksson', 'maria.eriksson@hyresgast.test', units.u1001),
    cafe: company('Kaffe & Kaka AB', '559900001', 'ekonomi@kaffeochkaka.test', {
      streetAddress: 'Kungsgatan 12',
      postalCode: '75321',
      city: 'Uppsala',
    }),
    salong: company('Salong Saxen AB', '559900002', 'info@salongsaxen.test', {
      streetAddress: 'Sysslomansgatan 21',
      postalCode: '75311',
      city: 'Uppsala',
    }),
    redovisning: company('Norrbacka Redovisning AB', '559900003', 'faktura@norrbacka.test', {
      streetAddress: 'Box 1182',
      postalCode: '75141',
      city: 'Uppsala',
    }),
  }
  await insertAll(schema.party, Object.values(tenants))

  // --- Leases, numbered in the order they were signed.
  const openEnded = (startDate: string, noticePeriodMonths = 3): LeaseTerms => ({
    startDate,
    termEndDate: null,
    extensionMonths: null,
    noticePeriodMonths,
    moveOutDate: null,
  })
  const terminated = (terms: LeaseTerms, noticeDate: string) => ({
    ...terms,
    noticeDate,
    moveOutDate: earliestMoveOutDate(terms, noticeDate),
  })
  type Payer = 'punctual' | 'late' | 'paper' | 'partial' | 'twice'
  interface SeedLease {
    key: string
    tenant: keyof typeof tenants
    /** Others on the same lease; the first tenant receives the avier. */
    coTenants?: (keyof typeof tenants)[]
    /** When the co-tenants joined, if later than the lease's start. */
    coTenantsFrom?: string
    units: Unit[]
    terms: LeaseTerms & { noticeDate?: string }
    rentOre: number
    rentInterval: 'monthly' | 'yearly'
    invoiceInterval: InvoiceInterval
    vat: boolean
    payer: Payer
  }
  const monthly = { rentInterval: 'monthly', invoiceInterval: 'monthly', vat: false } as const
  const commercial = (startDate: string, termEndDate: string): LeaseTerms => ({
    startDate,
    termEndDate,
    extensionMonths: 36,
    noticePeriodMonths: 9,
    moveOutDate: null,
  })
  const johanTerms = openEnded(addMonths(thisMonth, -50))
  const erikTerms = openEnded(addMonths(thisMonth, -30))
  // Oskar gave notice and was allowed to leave at the end of last month instead of waiting out
  // the notice period; this month's avi had already gone out (see the credit notes below).
  const oskarTerms = {
    ...openEnded(addMonths(thisMonth, -22)),
    noticeDate: addDays(thisMonth, -12),
    moveOutDate: addDays(thisMonth, -1),
  }
  const seedLeases: SeedLease[] = [
    {
      key: 'johan',
      tenant: 'johan',
      units: [units.l1001],
      terms: {
        ...johanTerms,
        noticeDate: addMonths(thisMonth, -18),
        moveOutDate: addDays(addMonths(thisMonth, -14), -1),
      },
      rentOre: 812_000,
      ...monthly,
      payer: 'punctual',
    },
    {
      key: 'elin',
      tenant: 'elin',
      units: [units.f1201],
      terms: openEnded(addMonths(thisMonth, -40)),
      rentOre: 780_000,
      ...monthly,
      payer: 'paper',
    },
    {
      key: 'erik',
      tenant: 'erik',
      units: [units.l1002],
      terms: terminated(erikTerms, addMonths(today, -1)),
      rentOre: 720_000,
      ...monthly,
      payer: 'punctual',
    },
    {
      key: 'cafe',
      tenant: 'cafe',
      units: [units.l2001, units.lP1],
      terms: commercial(`${year - 2}-01-01`, `${year}-12-31`),
      rentOre: 18_000_000,
      rentInterval: 'yearly',
      invoiceInterval: 'quarterly',
      vat: true,
      payer: 'punctual',
    },
    {
      key: 'fatima',
      tenant: 'fatima',
      units: [units.l1003],
      terms: openEnded(addMonths(thisMonth, -25)),
      rentOre: 620_000,
      ...monthly,
      payer: 'late',
    },
    {
      key: 'oskar',
      tenant: 'oskar',
      units: [units.f1102],
      terms: oskarTerms,
      rentOre: 710_000,
      ...monthly,
      payer: 'punctual',
    },
    {
      key: 'salong',
      tenant: 'salong',
      units: [units.u0101],
      terms: commercial(addMonths(thisMonth, -21), addDays(addMonths(thisMonth, 15), -1)),
      rentOre: 9_600_000,
      rentInterval: 'yearly',
      invoiceInterval: 'quarterly',
      vat: true,
      payer: 'partial',
    },
    {
      key: 'lars',
      tenant: 'lars',
      units: [units.lP3],
      terms: openEnded(addMonths(thisMonth, -20), 1),
      rentOre: 75_000,
      ...monthly,
      payer: 'punctual',
    },
    {
      key: 'mikael',
      tenant: 'mikael',
      coTenants: ['sofia'],
      // Sofia moved in with Mikael four months ago.
      coTenantsFrom: addMonths(thisMonth, -4),
      units: [units.l1101, units.lP2],
      terms: openEnded(addMonths(thisMonth, -18)),
      rentOre: 815_000,
      ...monthly,
      payer: 'twice',
    },
    {
      key: 'anna',
      tenant: 'anna',
      units: [units.l1001],
      terms: openEnded(addMonths(thisMonth, -14)),
      rentOre: 845_000,
      ...monthly,
      payer: 'punctual',
    },
    {
      key: 'ahmed',
      tenant: 'ahmed',
      units: [units.f1202, units.fF1],
      terms: openEnded(addMonths(thisMonth, -11)),
      rentOre: 725_000,
      ...monthly,
      payer: 'punctual',
    },
    {
      key: 'redovisning',
      tenant: 'redovisning',
      units: [units.u0102, units.uP1],
      terms: commercial(addMonths(thisMonth, -10), addDays(addMonths(thisMonth, 26), -1)),
      rentOre: 21_000_000,
      rentInterval: 'yearly',
      invoiceInterval: 'monthly',
      vat: true,
      payer: 'punctual',
    },
    {
      key: 'emma',
      tenant: 'emma',
      units: [units.l1102],
      terms: openEnded(addMonths(thisMonth, -9)),
      rentOre: 690_000,
      ...monthly,
      payer: 'punctual',
    },
    {
      key: 'maria',
      tenant: 'maria',
      units: [units.u1001],
      terms: openEnded(addMonths(thisMonth, -4)),
      rentOre: 730_000,
      ...monthly,
      payer: 'punctual',
    },
    {
      key: 'sara',
      tenant: 'sara',
      units: [units.f1101],
      terms: openEnded(addMonths(thisMonth, 1)),
      rentOre: 690_000,
      ...monthly,
      payer: 'paper',
    },
  ]
  const leases = seedLeases.map((l, i) => ({
    ...l,
    id: id(),
    number: i + 1,
    parties: [l.tenant, ...(l.coTenants ?? [])].map((key, index) => ({
      position: index + 1,
      receivesInvoices: index === 0,
      party: tenants[key],
      fromDate: index === 0 ? l.terms.startDate : (l.coTenantsFrom ?? l.terms.startDate),
      toDate: null,
    })),
  }))
  type Lease = (typeof leases)[number]
  const leaseByKey = (key: string) => {
    const found = leases.find((l) => l.key === key)
    if (!found) throw new Error(`seed lease ${key}`)
    return found
  }

  // What each lease bills, from a date: its rent from the start, plus a few changes below. Each
  // charge was recorded on `createdOn`; a seeded run only sees charges recorded by its issue date.
  type SeedCharge = Mutable<Charge> & { agreementId: string; createdOn: string }
  const charges: SeedCharge[] = leases.map((l) => ({
    id: id(),
    agreementId: l.id,
    kind: 'rent',
    unitId: null,
    description: null,
    amountOre: l.rentOre,
    interval: l.rentInterval,
    vat: l.vat,
    fromDate: l.terms.startDate,
    toDate: null,
    createdOn: addDays(l.terms.startDate, -30),
  }))
  const unitRows = leases.flatMap((l) =>
    l.units.map((u) => ({
      agreementId: l.id,
      unit: u,
      fromDate: l.terms.startDate,
      toDate: null as string | null,
    })),
  )
  const addCharge = (lease: Lease, charge: Omit<SeedCharge, 'id' | 'agreementId'>) => {
    const added = { ...charge, id: id(), agreementId: lease.id }
    charges.push(added)
    return added
  }
  // Emma's rent went up 3,5 % three months ago, agreed three weeks before.
  const emmaRaise = addMonths(thisMonth, -3)
  const emmaRent = charges.find((c) => c.agreementId === leaseByKey('emma').id)
  if (emmaRent) {
    emmaRent.toDate = addDays(emmaRaise, -1)
    addCharge(leaseByKey('emma'), {
      ...emmaRent,
      amountOre: Math.round((emmaRent.amountOre * 1.035) / 100) * 100,
      fromDate: emmaRaise,
      toDate: null,
      createdOn: addDays(emmaRaise, -21),
    })
  }
  // Fatima added parking space P4 two months ago, at 650 kr a month on top of her rent.
  const fatimaParking = addMonths(thisMonth, -2)
  unitRows.push({
    agreementId: leaseByKey('fatima').id,
    unit: units.lP4,
    fromDate: fatimaParking,
    toDate: null,
  })
  addCharge(leaseByKey('fatima'), {
    kind: 'parking',
    unitId: units.lP4.id,
    description: null,
    amountOre: 65_000,
    interval: 'monthly',
    vat: false,
    fromDate: fatimaParking,
    toDate: null,
    createdOn: addDays(fatimaParking, -25),
  })
  // Anna lost a key today; the replacement goes on her next avi.
  addCharge(leaseByKey('anna'), {
    kind: 'one_off',
    unitId: null,
    description: 'Ny nyckel',
    amountOre: 45_000,
    interval: 'once',
    vat: false,
    fromDate: today,
    toDate: null,
    createdOn: today,
  })

  // The commercial leases have Fastighetsägarna's index clause: all of the base rent follows KPI
  // from October before the lease started, adjusted each 1 January. Past adjustments were run in
  // late November, after SCB published October, with the same rules as "Indexuppräkning".
  const kpiByMonth = new Map(
    (await db.select().from(schema.kpi)).map((k) => [k.month, k.valueHundredths]),
  )
  const indexClauses = ['cafe', 'salong', 'redovisning'].map((key) => {
    const lease = leaseByKey(key)
    return { lease, baseMonth: defaultBaseMonth(lease.terms.startDate) }
  })
  const indexAdjustments: (typeof schema.indexAdjustment.$inferInsert)[] = []
  for (const { lease, baseMonth } of indexClauses) {
    const baseKpi = kpiByMonth.get(baseMonth)
    let previous: SeedCharge | null = null
    for (let y = Number(lease.terms.startDate.slice(0, 4)) + 1; y <= year; y++) {
      const date = adjustmentDate(y, 1)
      const kpiMonth = kpiMonthFor(date)
      const value = kpiByMonth.get(kpiMonth)
      const recordedOn = `${y - 1}-11-20`
      if (baseKpi === undefined || value === undefined || recordedOn > today) break
      const baseRentPerYearOre = perYear(lease.rentOre, lease.rentInterval)
      const supplementOre = indexSupplement({
        baseRentPerYearOre,
        sharePercent: 100,
        baseKpi,
        kpi: value,
        floorAtBase: true,
      })
      if (previous) previous.toDate = addDays(date, -1)
      previous =
        supplementOre === 0
          ? null
          : addCharge(lease, {
              kind: 'index',
              unitId: null,
              description: null,
              amountOre: supplementOre,
              interval: 'yearly',
              vat: lease.vat,
              fromDate: date,
              toDate: null,
              createdOn: recordedOn,
            })
      indexAdjustments.push({
        organizationId: orgId,
        agreementId: lease.id,
        effectiveDate: date,
        baseMonth,
        baseKpiHundredths: baseKpi,
        kpiMonth,
        kpiHundredths: value,
        baseRentOre: baseRentPerYearOre,
        supplementOre,
        chargeId: previous?.id ?? null,
        // The tenants were emailed about the new rent with the run.
        notifiedAt: new Date(`${recordedOn}T09:00:00Z`),
        createdAt: new Date(`${recordedOn}T09:00:00Z`),
      })
    }
  }

  // Leases are agreements with lease terms; the agreement's end date is the last billed day.
  await insertAll(
    schema.agreement,
    leases.map((l) => ({
      id: l.id,
      organizationId: orgId,
      number: l.number,
      kind: 'lease' as const,
      startDate: l.terms.startDate,
      endDate: effectiveEndDate(l.terms),
      invoiceInterval: l.invoiceInterval,
      createdAt: new Date(`${addDays(l.terms.startDate, -between(20, 45))}T09:00:00Z`),
    })),
  )
  await insertAll(
    schema.charge,
    charges.map(({ createdOn, ...c }) => ({
      ...c,
      organizationId: orgId,
      createdAt: new Date(`${createdOn}T09:00:00Z`),
    })),
  )
  await insertAll(
    schema.indexClause,
    indexClauses.map(({ lease, baseMonth }) => ({
      agreementId: lease.id,
      organizationId: orgId,
      baseMonth,
    })),
  )
  await insertAll(schema.indexAdjustment, indexAdjustments)
  await insertAll(
    schema.leaseTerms,
    leases.map((l) => ({
      agreementId: l.id,
      organizationId: orgId,
      termEndDate: l.terms.termEndDate,
      extensionMonths: l.terms.extensionMonths,
      noticePeriodMonths: l.terms.noticePeriodMonths,
      moveOutDate: l.terms.moveOutDate,
      noticeDate: l.terms.noticeDate ?? null,
    })),
  )
  await insertAll(
    schema.agreementParty,
    leases.flatMap((l) =>
      l.parties.map((p, index) => ({
        agreementId: l.id,
        partyId: p.party.id,
        organizationId: orgId,
        role: index === 0 ? ('tenant' as const) : ('co_tenant' as const),
        receivesInvoices: p.receivesInvoices,
        position: p.position,
        fromDate: p.fromDate,
      })),
    ),
  )
  await insertAll(
    schema.agreementUnit,
    unitRows.map((u) => ({
      agreementId: u.agreementId,
      unitId: u.unit.id,
      organizationId: orgId,
      fromDate: u.fromDate,
      toDate: u.toDate,
    })),
  )

  // --- Invoice runs: one a month for the last eight months and the coming one, each issued 20
  // days before its month starts (only runs whose issue date has passed). Built with the same
  // rule as "Skapa avier" (`billFor`), from the charges, parties and units of each lease.
  type Invoice = typeof schema.invoice.$inferInsert & {
    id: string
    lease: Lease
    lines: InvoiceLineDraft[]
    /** Credit notes against it, so a payment only subtracts those issued before it was made. */
    credits: { issueDate: string; totalOre: number }[]
    /** When a payment settled it; the ledger records the payment itself. */
    paidOn?: string
  }
  const invoices: Invoice[] = []
  const billedOnce = new Set<string>()
  const billable = (lease: Lease, issueDate: string): BillableAgreement => ({
    startDate: lease.terms.startDate,
    endDate: effectiveEndDate(lease.terms),
    charges: charges.filter((c) => c.agreementId === lease.id && c.createdOn <= issueDate),
    parties: lease.parties,
    units: unitRows
      .filter((u) => u.agreementId === lease.id)
      .map((u) => ({
        ...u,
        unitId: u.unit.id,
        designation: u.unit.designation,
        label: u.unit.label,
      })),
  })
  const invoiceFor = (
    lease: Lease,
    period: Period,
    issueDate: string,
    agreement = billable(lease, issueDate),
  ) => {
    const bill = billFor(agreement, period, billedOnce)
    if (!bill) return
    for (const line of bill.lines) if (line.kind === 'one_off') billedOnce.add(line.chargeId)
    const number = invoices.length + 1
    invoices.push({
      id: id(),
      lease,
      organizationId: orgId,
      number,
      ocr: ocrFor(number),
      agreementId: lease.id,
      ...bill.recipient,
      periodStart: period.start,
      periodEnd: period.end,
      issueDate,
      dueDate: dueDate(period, issueDate),
      netOre: bill.netOre,
      vatOre: bill.vatOre,
      totalOre: bill.totalOre,
      sentAt: bill.recipient.recipientEmail
        ? new Date(`${issueDate}T07:${between(10, 50)}:00Z`)
        : null,
      createdAt: new Date(`${issueDate}T07:00:00Z`),
      lines: bill.lines,
      credits: [],
    })
  }
  let oskarCredited: Invoice | undefined
  for (let offset = -8; offset <= 1; offset++) {
    const monthStart = addMonths(thisMonth, offset)
    const issueDate = addDays(monthStart, -20)
    if (issueDate > today) break
    for (const lease of leases) {
      const period = invoicePeriod(monthStart.slice(0, 7), lease.invoiceInterval)
      if (!period) continue
      // When this month's run went out, Oskar still lived there: invoice him as the lease was.
      const asSigned =
        lease.key === 'oskar' && offset === 0
          ? { ...billable(lease, issueDate), endDate: null }
          : billable(lease, issueDate)
      const before = invoices.length
      invoiceFor(lease, period, issueDate, asSigned)
      if (lease.key === 'oskar' && offset === 0 && invoices.length > before) {
        oskarCredited = invoices.at(-1)
      }
    }
    // Two months back Ahmed's avi was created with his old address and caught before it was sent.
    // It was voided and a corrected avi issued for the same period ("Ny avi för perioden").
    const ahmed = leaseByKey('ahmed')
    const wrong = invoices.find((i) => i.lease === ahmed && i.issueDate === issueDate)
    if (offset === -2 && wrong) {
      const correctedOn = addDays(issueDate, 2)
      wrong.voidedAt = new Date(`${correctedOn}T09:00:00Z`)
      wrong.sentAt = null
      invoiceFor(ahmed, { start: wrong.periodStart, end: wrong.periodEnd }, correctedOn)
      const corrected = invoices.at(-1)
      if (corrected) corrected.replacesInvoiceId = wrong.id
    }
  }
  await insertAll(
    schema.invoice,
    invoices.map(({ lease: _, lines: __, credits: ___, paidOn: ____, ...i }) => i),
  )
  await insertAll(
    schema.invoiceLine,
    invoices.flatMap((i) =>
      i.lines.map((line, index) => ({
        ...line,
        invoiceId: i.id,
        organizationId: orgId,
        position: index + 1,
      })),
    ),
  )

  // --- Credit notes, in date order. Each is built with the "Kreditera" rule and lowers what is
  // still owed on its invoice.
  const creditNotes: (typeof schema.creditNote.$inferInsert & {
    lines: ReturnType<typeof draftCreditNote> & { ok: true }
    /** When a credit on a paid avi was paid back; the ledger records the refund. */
    refundedOn?: string
  })[] = []
  const credit = (invoice: Invoice, request: CreditRequest, reason: string, issueDate: string) => {
    const result = draftCreditNote(
      {
        number: invoice.number,
        totalOre: invoice.totalOre,
        creditedOre: invoice.creditedOre ?? 0,
        voidedAt: null,
        lines: invoice.lines,
      },
      request,
    )
    if (!result.ok) throw new Error(`seed credit note for avi ${invoice.number}: ${result.problem}`)
    invoice.creditedOre = (invoice.creditedOre ?? 0) + result.draft.totalOre
    invoice.credits.push({ issueDate, totalOre: result.draft.totalOre })
    creditNotes.push({
      id: id(),
      organizationId: orgId,
      number: creditNotes.length + 1,
      invoiceId: invoice.id,
      reason,
      recipientName: invoice.recipientName,
      recipientStreetAddress: invoice.recipientStreetAddress,
      recipientPostalCode: invoice.recipientPostalCode,
      recipientCity: invoice.recipientCity,
      recipientEmail: invoice.recipientEmail,
      issueDate,
      netOre: result.draft.netOre,
      vatOre: result.draft.vatOre,
      totalOre: result.draft.totalOre,
      sentAt: invoice.recipientEmail ? new Date(`${issueDate}T10:15:00Z`) : null,
      createdAt: new Date(`${issueDate}T10:00:00Z`),
      lines: result,
    })
    return creditNotes.at(-1)
  }
  const latest = (key: string, monthsBack = 0) =>
    invoices.filter((i) => i.lease.key === key).at(-1 - monthsBack)
  // 1. Emma had no hot water for a week; credited after she had paid, and paid back a week later.
  const emma = latest('emma', 4)
  const emmaCredit =
    emma &&
    credit(
      emma,
      { kind: 'amount', netOre: 40_000 },
      'Ersättning för avstängt varmvatten',
      addDays(emma.dueDate as string, 18),
    )
  if (emmaCredit) emmaCredit.refundedOn = bankDay(addDays(emmaCredit.issueDate, 7))
  // 2. The office rent was raised too early; three months back is refunded (already paid).
  const office = latest('redovisning', 3)
  if (office) {
    credit(
      office,
      { kind: 'amount', netOre: 150_000 },
      'Hyran höjdes en månad för tidigt',
      addDays(office.dueDate as string, 12),
    )
  }
  // 3. Oskar's last avi, for the month after he moved out. Credited the day the earlier
  // move-out was agreed, before the avi fell due, so he never paid it.
  if (oskarCredited) {
    credit(
      oskarCredited,
      { kind: 'rest' },
      'Avflyttning tidigarelagd enligt överenskommelse',
      oskarTerms.noticeDate,
    )
  }
  // 4. Anna's broken dishwasher took three weeks to replace.
  const annaNow = invoices.find((i) => i.lease.key === 'anna' && i.periodStart === thisMonth)
  if (annaNow) {
    credit(
      annaNow,
      { kind: 'amount', netOre: 100_000 },
      'Hyresreduktion för trasig diskmaskin',
      addDays(today, -5),
    )
  }

  // --- Payments, as the bank reported them. Each tenant pays in their own way.
  const yesterday = addDays(today, -1)
  interface SeedPayment {
    id: string
    bookingDate: string
    amountOre: number
    reference: string | null
    payerName: string
    invoice: Invoice | null
    status: (typeof schema.payment.$inferInsert)['status']
    note: string | null
    marksInvoicePaid: boolean
  }
  const payments: SeedPayment[] = []
  const pay = (invoice: Invoice, bookingDate: string, extra: Partial<SeedPayment> = {}) => {
    const date = bankDay(bookingDate)
    if (date > yesterday) return
    const creditedBefore = invoice.credits
      .filter((c) => c.issueDate <= date)
      .reduce((sum, c) => sum + c.totalOre, 0)
    const due = invoice.totalOre - creditedBefore
    const payment: SeedPayment = {
      id: id(),
      bookingDate: date,
      amountOre: due,
      reference: invoice.ocr,
      // The bank names the account holder: the party that receives the avier.
      payerName: (
        Object.values(tenants).find((t) => t.id === invoice.partyId)?.name ?? invoice.recipientName
      ).toUpperCase(),
      invoice,
      status: 'matched',
      note: null,
      marksInvoicePaid: true,
      ...extra,
    }
    payments.push(payment)
    if (payment.marksInvoicePaid) invoice.paidOn = date
  }
  // Elin's newest avi that has fallen due: her payment for it is still waiting for a person.
  const elinWaiting = invoices
    .filter((i) => i.lease.key === 'elin' && (i.dueDate as string) <= yesterday)
    .at(-1)
  for (const invoice of invoices) {
    const due = invoice.dueDate as string
    const lease = invoice.lease
    const owed = invoice.totalOre - (invoice.creditedOre ?? 0)
    if (owed <= 0 || invoice.voidedAt) continue
    // Anna's newest avi is left unpaid so it shows as overdue.
    if (lease.key === 'anna' && invoice === annaNow) continue
    switch (lease.payer) {
      case 'punctual':
        pay(invoice, addDays(due, -between(0, 5)))
        break
      case 'late':
        // Usually a week or two late.
        pay(invoice, addDays(due, between(4, 16)))
        break
      case 'paper':
        // Pays on the due date without the OCR number, so every payment needs a person. The
        // newest one is still waiting; the older ones were linked by hand.
        if (invoice === elinWaiting) {
          pay(invoice, due, {
            reference: null,
            invoice: null,
            status: 'unmatched',
            marksInvoicePaid: false,
          })
        } else {
          pay(invoice, due, { reference: null, note: 'Kopplad manuellt' })
        }
        break
      case 'partial':
        // The salon paid only part of last quarter and the rest is still open.
        if (invoice === latest('salong', 1)) {
          const part = Math.round((owed * 0.6) / 100) * 100
          pay(invoice, addDays(due, 2), {
            amountOre: part,
            status: 'review',
            marksInvoicePaid: false,
            note: `Delbetalning: ${formatSek(part)} av ${formatSek(owed)} på avi ${invoice.number}`,
          })
        } else {
          pay(invoice, addDays(due, -between(1, 4)))
        }
        break
      case 'twice':
        pay(invoice, addDays(due, -between(1, 3)))
        // Mikael's standing order paid one month twice; the bank file flagged it for review.
        if (invoice === latest('mikael', 2)) {
          pay(invoice, addDays(due, 1), {
            status: 'review',
            marksInvoicePaid: false,
            note: `Avi ${invoice.number} är redan betald (${invoice.paidOn})`,
          })
        }
        break
    }
  }
  // Maria's deposit came in without an OCR number and is handled outside the avier.
  const mariaLease = leases.find((l) => l.key === 'maria')
  if (mariaLease) {
    payments.push({
      id: id(),
      bookingDate: bankDay(addDays(mariaLease.terms.startDate, -12)),
      amountOre: 1_460_000,
      reference: null,
      payerName: 'MARIA ERIKSSON',
      invoice: null,
      status: 'ignored',
      note: null,
      marksInvoicePaid: false,
    })
  }
  payments.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate))

  // One bank file a week, imported the Monday after (or yesterday, for the current week).
  const imports = new Map<string, SeedPayment[]>()
  for (const p of payments) {
    const weekday = (new Date(`${p.bookingDate}T00:00:00Z`).getUTCDay() + 6) % 7
    const monday = addDays(p.bookingDate, -weekday)
    imports.set(monday, [...(imports.get(monday) ?? []), p])
  }
  let bankSequence = 0
  for (const [monday, batch] of imports) {
    const importedOn = addDays(monday, 7) <= today ? addDays(monday, 7) : today
    const importId = id()
    await db.insert(schema.paymentImport).values({
      id: importId,
      organizationId: orgId,
      fileName: `camt054_${monday.replaceAll('-', '')}.xml`,
      messageId: `BGC${monday.replaceAll('-', '')}${between(1000, 9999)}`,
      importedByUserId: rand() < 0.7 ? owner.id : member.id,
      paymentCount: batch.length,
      duplicateCount: 0,
      totalOre: batch.reduce((sum, p) => sum + p.amountOre, 0),
      createdAt: new Date(`${importedOn}T08:${between(10, 50)}:00Z`),
    })
    await insertAll(
      schema.payment,
      batch.map((p) => ({
        id: p.id,
        organizationId: orgId,
        importId,
        bankReference: `${p.bookingDate.replaceAll('-', '')}${String(++bankSequence).padStart(6, '0')}`,
        bookingDate: p.bookingDate,
        amountOre: p.amountOre,
        reference: p.reference,
        payerName: p.payerName,
        status: p.status,
        note: p.note,
        createdAt: new Date(`${importedOn}T08:00:00Z`),
      })),
    )
  }

  // Credited totals were settled above; write the cache onto the invoices.
  for (const invoice of invoices) {
    if (!invoice.creditedOre) continue
    await db
      .update(schema.invoice)
      .set({ creditedOre: invoice.creditedOre })
      .where(eq(schema.invoice.id, invoice.id))
  }
  for (const { lines, refundedOn: _, ...note } of creditNotes) {
    await db.insert(schema.creditNote).values(note)
    await insertAll(
      schema.creditNoteLine,
      lines.draft.lines.map((line, index) => ({
        creditNoteId: note.id as string,
        organizationId: orgId,
        position: index + 1,
        ...line,
      })),
    )
  }

  // --- The ledger: every avi, void, credit note, payment, match and refund above as postings.
  const ledger = seedLedger(orgId)
  for (const invoice of invoices) {
    const owner = { partyId: invoice.partyId, agreementId: invoice.agreementId }
    ledger.post(
      {
        date: invoice.issueDate,
        kind: 'invoice',
        description: `Avi ${invoice.number}`,
        invoiceId: invoice.id,
      },
      invoiceEntries({ ...invoice, lines: invoice.lines }),
      owner,
    )
    if (invoice.voidedAt) {
      ledger.post(
        {
          date: stockholmDate(invoice.voidedAt.getTime()),
          kind: 'void',
          description: `Makulering av avi ${invoice.number}`,
          invoiceId: invoice.id,
        },
        reversal(invoiceEntries({ ...invoice, lines: invoice.lines })),
        owner,
      )
    }
  }
  for (const note of creditNotes) {
    const invoice = invoices.find((i) => i.id === note.invoiceId) as Invoice
    const owner = { partyId: invoice.partyId, agreementId: invoice.agreementId }
    ledger.post(
      {
        date: note.issueDate,
        kind: 'credit_note',
        description: `Kreditfaktura ${note.number}`,
        invoiceId: invoice.id,
        creditNoteId: note.id,
      },
      creditNoteEntries(invoice.id, note.lines.draft),
      owner,
    )
    if (note.refundedOn) {
      ledger.post(
        {
          date: note.refundedOn,
          kind: 'refund',
          description: `Återbetalning, avi ${invoice.number}`,
          invoiceId: invoice.id,
        },
        refundEntries(invoice.id, note.totalOre),
        owner,
      )
    }
  }
  for (const p of payments) {
    ledger.post(
      { date: p.bookingDate, kind: 'payment', description: 'Inbetalning', paymentId: p.id },
      paymentEntries(p.id, p.amountOre),
    )
    if (p.status === 'matched' && p.invoice) {
      ledger.post(
        {
          date: p.bookingDate,
          kind: 'allocation',
          description: `Betalning av avi ${p.invoice.number}`,
          invoiceId: p.invoice.id,
          paymentId: p.id,
        },
        allocationEntries(p.id, p.invoice.id, p.amountOre),
        { partyId: p.invoice.partyId, agreementId: p.invoice.agreementId },
      )
    }
  }
  const reminders = seedReminders(
    orgId,
    ledger,
    invoices
      .filter((i) => !i.paidOn && !i.voidedAt)
      .map((i) => ({
        ...i,
        dueDate: i.dueDate as string,
        recipientEmail: i.recipientEmail ?? null,
        owedOre: i.totalOre - (i.creditedOre ?? 0),
      })),
    { reminderFeeOre: 6_000, reminderIntervalDays: 10, reminderDueDays: 10 },
    today,
  )
  await ledger.write()
  await insertAll(schema.paymentReminder, reminders)

  // The month before last was exported to the bookkeeping program, so exporting it again warns.
  const exported = {
    fromDate: addMonths(thisMonth, -2),
    toDate: endOfMonth(addMonths(thisMonth, -2)),
  }
  const [{ vouchers }] = await db
    .select({ vouchers: count() })
    .from(schema.posting)
    .where(
      and(
        eq(schema.posting.organizationId, orgId),
        gte(schema.posting.date, exported.fromDate),
        lte(schema.posting.date, exported.toDate),
      ),
    )
  await db.insert(schema.bookkeepingExport).values({
    organizationId: orgId,
    ...exported,
    voucherCount: vouchers,
    exportedByUserId: owner.id,
    createdAt: new Date(Date.now() - 20 * 86_400_000),
  })

  const open = invoices.filter((i) => !i.paidOn && !i.voidedAt && i.totalOre > (i.creditedOre ?? 0))
  console.log(`Seeded ${org.name}:
  logins     ${owner.email} (owner), ${member.email} (member). Password: SEED_PASSWORD in scripts/db-seed-constants.ts
  bankgiro   ${settings.bankgiro}, org.nr ${settings.organizationNumber}
  data       ${Object.keys(properties).length} properties, ${Object.keys(units).length} units, ${Object.keys(tenants).length} tenants, ${leases.length} leases
  invoices   ${invoices.length} (${open.length} open), ${creditNotes.length} credit notes
  payments   ${payments.length} in ${imports.size} bank files (${payments.filter((p) => p.status !== 'matched').length} need attention or ignored)`)
}

/**
 * A second company: a small housing cooperative (Brf Linden) with its own board login. Ten
 * bostadsrätter billed monthly by andelstal, one of them sold three months ago, and a hair salon
 * renting the commercial unit on a normal lease. Avier come from monthly runs like the landlord's.
 */
async function seedBrf() {
  const today = stockholmDate(Date.now())
  const thisMonth = `${today.slice(0, 7)}-01`
  const now = new Date()
  const rand = random(20261101)
  const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))

  const board = { id: id(), ...SEED_USERS.brf }
  await db
    .insert(schema.user)
    .values({ ...board, emailVerified: true, createdAt: now, updatedAt: now })
  await db.insert(schema.account).values({
    id: id(),
    accountId: board.id,
    providerId: 'credential',
    userId: board.id,
    password: await hashPassword(SEED_PASSWORD),
    createdAt: now,
    updatedAt: now,
  })
  const org = { id: id(), name: 'Brf Linden', slug: 'brf-linden' }
  const orgId = org.id
  await db.insert(schema.organization).values({ ...org, createdAt: now })
  await db
    .insert(schema.member)
    .values({ id: id(), organizationId: orgId, userId: board.id, role: 'owner', createdAt: now })
  const settings = {
    organizationNumber: formatOrganizationNumber(withCheckDigit('769900000')),
    bankgiro: formatBankgiro(withCheckDigit('990100')),
  }
  await db.insert(schema.organizationSettings).values({
    organizationId: orgId,
    ...settings,
    streetAddress: 'Lindgatan 3',
    postalCode: '75330',
    city: 'Uppsala',
    email: 'styrelsen@brflinden.test',
    fSkatt: false,
    kind: 'brf',
  })

  const property = {
    id: id(),
    organizationId: orgId,
    designation: 'Uppsala Svartbäcken 3:12',
    name: 'Brf Linden',
    streetAddress: 'Lindgatan 3',
    postalCode: '75330',
    city: 'Uppsala',
  }
  await db.insert(schema.property).values(property)
  const unit = (kind: UnitKind, label: string, areaSqm: number | null, rooms: number | null) => ({
    id: id(),
    organizationId: orgId,
    propertyId: property.id,
    kind,
    label,
    areaSqm,
    rooms,
  })
  const flats = [
    unit('apartment', '1001', 54, 2),
    unit('apartment', '1002', 76, 3),
    unit('apartment', '1003', 41, 1),
    unit('apartment', '1101', 54, 2),
    unit('apartment', '1102', 76, 3),
    unit('apartment', '1103', 41, 1),
    unit('apartment', '1201', 54, 2),
    unit('apartment', '1202', 76, 3),
    unit('apartment', '1203', 41, 1),
    unit('apartment', '1301', 98, 4),
  ]
  const salonUnit = unit('commercial', '0101', 62, null)
  const storage = unit('storage', 'F1', 5, null)
  await insertAll(schema.unit, [...flats, salonUnit, storage])

  // Members. Couples own together, mostly half each; Lina and Omar 60/40.
  const person = (name: string, email: string | null) => ({
    id: id(),
    organizationId: orgId,
    kind: 'person' as const,
    name,
    organizationNumber: null,
    email,
    phone: `07${between(0, 6)}-${between(100, 999)} ${between(10, 99)} ${between(10, 99)}`,
    streetAddress: property.streetAddress,
    postalCode: property.postalCode,
    city: 'Uppsala',
  })
  const mail = (name: string) =>
    `${name
      .toLowerCase()
      .replace(/ /g, '.')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')}@medlem.test`
  const names = [
    'Karin Lund',
    'Per Lund',
    'Hanna Berg',
    'Jonas Ek',
    'Lina Holm',
    'Omar Haddad',
    'Ulla Sjöberg',
    'Axel Nyström',
    'Sanna Nyström',
    'Ida Karlsson',
    'Mats Wik',
    'Rut Åberg',
    'Nils Åberg',
    'Tove Lindgren',
    'Elsa Strand',
    'Viktor Strand',
  ]
  const members = Object.fromEntries(
    names.map((n) => [n, person(n, n === 'Ulla Sjöberg' ? null : mail(n))]),
  )
  const salonOwner = {
    id: id(),
    organizationId: orgId,
    kind: 'company' as const,
    name: 'Klippet Linden AB',
    organizationNumber: formatOrganizationNumber(withCheckDigit('559900077')),
    email: 'info@klippet.test',
    phone: '018-12 34 56',
    streetAddress: property.streetAddress,
    postalCode: property.postalCode,
    city: 'Uppsala',
  }
  await insertAll(schema.party, [...Object.values(members), salonOwner])

  // Andelstal by living area; the fee pool is split by it (rounded to whole kronor a month).
  const totalArea = flats.reduce((sum, f) => sum + (f.areaSqm ?? 0), 0)
  const yearlyFeesOre = 430_000_00
  const shareOf = (flat: (typeof flats)[number]) =>
    Math.round(((flat.areaSqm ?? 0) / totalArea) * 100 * 1000) / 1000
  const feeOf = (flat: (typeof flats)[number]) =>
    Math.round((yearlyFeesOre * shareOf(flat)) / 100 / 12 / 100) * 100

  type Agreement = typeof schema.agreement.$inferInsert & {
    id: string
    units: { designation: string; label: string; fromDate: string; toDate: null }[]
    parties: {
      position: number
      receivesInvoices: boolean
      fromDate: string
      toDate: null
      party: Party['party']
    }[]
  }
  const agreements: Agreement[] = []
  const charges: (Mutable<Charge> & { agreementId: string })[] = []
  const terms: (typeof schema.ownershipTerms.$inferInsert)[] = []
  const parties: (typeof schema.agreementParty.$inferInsert)[] = []
  const links: (typeof schema.agreementUnit.$inferInsert)[] = []
  const owned = (
    flat: (typeof flats)[number],
    owners: [string, number][],
    startDate: string,
    extra: {
      endDate?: string
      previousAgreementId?: string
      units?: (typeof flats)[number][]
    } = {},
  ) => {
    const ownership: Agreement = {
      id: id(),
      organizationId: orgId,
      number: agreements.length + 1,
      kind: 'tenant_ownership',
      startDate,
      endDate: extra.endDate ?? null,
      invoiceInterval: 'monthly',
      createdAt: new Date(`${addDays(startDate, -between(10, 30))}T09:00:00Z`),
      units: [flat, ...(extra.units ?? [])].map((u) => ({
        designation: property.designation,
        label: u.label,
        fromDate: startDate,
        toDate: null,
      })),
      parties: owners.map(([name], i) => ({
        position: i + 1,
        receivesInvoices: i === 0,
        fromDate: startDate,
        toDate: null,
        party: members[name],
      })),
    }
    agreements.push(ownership)
    charges.push({
      id: id(),
      agreementId: ownership.id,
      kind: 'fee',
      unitId: null,
      description: null,
      amountOre: feeOf(flat),
      interval: 'monthly',
      vat: false,
      fromDate: startDate,
      toDate: null,
    })
    terms.push({
      agreementId: ownership.id,
      organizationId: orgId,
      previousAgreementId: extra.previousAgreementId ?? null,
    })
    parties.push(
      ...owners.map(([name, share], i) => ({
        agreementId: ownership.id,
        partyId: members[name].id,
        organizationId: orgId,
        role: 'owner' as const,
        sharePercent: share,
        receivesInvoices: i === 0,
        position: i + 1,
        fromDate: startDate,
      })),
    )
    for (const u of [flat, ...(extra.units ?? [])]) {
      links.push({
        agreementId: ownership.id,
        unitId: u.id,
        organizationId: orgId,
        fromDate: startDate,
      })
    }
    return ownership
  }
  const half = equalShares(2)
  const couple = (a: string, b: string): [string, number][] => [
    [a, half[0]],
    [b, half[1]],
  ]
  const [f1001, f1002, f1003, f1101, f1102, f1103, f1201, f1202, f1203, f1301] = flats
  owned(f1001, couple('Karin Lund', 'Per Lund'), '2015-09-01')
  owned(f1002, [['Hanna Berg', 100]], '2019-03-01')
  owned(f1003, [['Jonas Ek', 100]], '2022-06-01')
  owned(
    f1101,
    [
      ['Lina Holm', 60],
      ['Omar Haddad', 40],
    ],
    '2020-11-01',
  )
  owned(f1102, [['Ulla Sjöberg', 100]], '2004-05-01', { units: [storage] })
  // 1103 was sold three months ago: Ida Karlsson's bostadsrätt ended, Mats Wik's began.
  const soldOn = addMonths(thisMonth, -3)
  const sold = owned(f1103, [['Ida Karlsson', 100]], '2018-02-01', { endDate: addDays(soldOn, -1) })
  owned(f1201, couple('Axel Nyström', 'Sanna Nyström'), '2021-08-01')
  owned(f1202, couple('Rut Åberg', 'Nils Åberg'), '2010-04-01')
  owned(f1203, [['Tove Lindgren', 100]], '2023-01-01')
  owned(f1301, couple('Elsa Strand', 'Viktor Strand'), '2017-10-01')
  owned(f1103, [['Mats Wik', 100]], soldOn, { previousAgreementId: sold.id })

  // The board raised every fee by 4 % two months ago, decided well before the run went out.
  const feeRaise = addMonths(thisMonth, -2)
  for (const fee of [...charges]) {
    const ownership = agreements.find((a) => a.id === fee.agreementId)
    if (!ownership || (ownership.endDate && ownership.endDate < feeRaise)) continue
    fee.toDate = addDays(feeRaise, -1)
    charges.push({
      ...fee,
      id: id(),
      amountOre: Math.round((fee.amountOre * 1.04) / 100) * 100,
      fromDate: feeRaise,
      toDate: null,
    })
  }

  // The apartment register: each apartment's andelstal, insats and upplåtelse, kept across sales.
  const register = flats.map((flat) => ({
    unitId: flat.id,
    organizationId: orgId,
    shareRatio: shareOf(flat),
    depositOre: Math.round(((flat.areaSqm ?? 0) * 6_500_00) / 100_000) * 100_000,
    grantFeeOre: null,
    grantedOn: '2004-05-01',
  }))

  // The salon rents the commercial unit on an ordinary lease, with VAT, invoiced quarterly.
  const salonLease: Agreement = {
    id: id(),
    organizationId: orgId,
    number: agreements.length + 1,
    kind: 'lease',
    startDate: '2024-01-01',
    endDate: null,
    invoiceInterval: 'quarterly',
    createdAt: new Date('2023-11-20T09:00:00Z'),
    units: [
      {
        designation: property.designation,
        label: salonUnit.label,
        fromDate: '2024-01-01',
        toDate: null,
      },
    ],
    parties: [
      {
        position: 1,
        receivesInvoices: true,
        fromDate: '2024-01-01',
        toDate: null,
        party: salonOwner,
      },
    ],
  }
  agreements.push(salonLease)
  charges.push({
    id: id(),
    agreementId: salonLease.id,
    kind: 'rent',
    unitId: null,
    description: null,
    amountOre: 16_800_000,
    interval: 'yearly',
    vat: true,
    fromDate: '2024-01-01',
    toDate: null,
  })
  parties.push({
    agreementId: salonLease.id,
    partyId: salonOwner.id,
    organizationId: orgId,
    role: 'tenant',
    receivesInvoices: true,
    position: 1,
    fromDate: '2024-01-01',
  })
  links.push({
    agreementId: salonLease.id,
    unitId: salonUnit.id,
    organizationId: orgId,
    fromDate: '2024-01-01',
  })

  await insertAll(
    schema.agreement,
    agreements.map(({ units: _, parties: __, ...a }) => a),
  )
  await insertAll(
    schema.charge,
    charges.map((c) => ({ ...c, organizationId: orgId })),
  )
  await insertAll(schema.ownershipTerms, terms)
  await insertAll(schema.brfApartment, register)
  await db.insert(schema.leaseTerms).values({
    agreementId: salonLease.id,
    organizationId: orgId,
    termEndDate: '2026-12-31',
    extensionMonths: 36,
    noticePeriodMonths: 9,
  })
  await insertAll(schema.agreementParty, parties)
  await insertAll(schema.agreementUnit, links)

  // Monthly runs for the last four months and the coming one, issued 20 days ahead.
  const invoices: (typeof schema.invoice.$inferInsert & {
    id: string
    lines: InvoiceLineDraft[]
    paidOn?: string
  })[] = []
  for (let offset = -4; offset <= 1; offset++) {
    const monthStart = addMonths(thisMonth, offset)
    const issueDate = addDays(monthStart, -20)
    if (issueDate > today) break
    for (const a of agreements) {
      const period = invoicePeriod(monthStart.slice(0, 7), a.invoiceInterval)
      if (!period) continue
      const bill = billFor(
        {
          startDate: a.startDate,
          endDate: a.endDate ?? null,
          charges: charges.filter((c) => c.agreementId === a.id),
          parties: a.parties,
          units: a.units,
        },
        period,
        new Set(),
      )
      if (!bill) continue
      const number = invoices.length + 1
      invoices.push({
        id: id(),
        organizationId: orgId,
        number,
        ocr: ocrFor(number),
        agreementId: a.id,
        ...bill.recipient,
        periodStart: period.start,
        periodEnd: period.end,
        issueDate,
        dueDate: dueDate(period, issueDate),
        netOre: bill.netOre,
        vatOre: bill.vatOre,
        totalOre: bill.totalOre,
        sentAt: bill.recipient.recipientEmail
          ? new Date(`${issueDate}T07:${between(10, 50)}:00Z`)
          : null,
        createdAt: new Date(`${issueDate}T07:00:00Z`),
        lines: bill.lines,
      })
    }
  }

  // Everyone pays by OCR a few days early, except Jonas, whose newest past-due avi is unpaid.
  const yesterday = addDays(today, -1)
  const jonas = agreements.find((a) => a.parties[0]?.party.name === 'Jonas Ek')
  const jonasLate = invoices
    .filter((i) => i.agreementId === jonas?.id && (i.dueDate as string) <= yesterday)
    .at(-1)
  const payments: (typeof schema.payment.$inferInsert & {
    id: string
    invoice: (typeof invoices)[number]
  })[] = []
  const importId = id()
  for (const invoice of invoices) {
    if (invoice === jonasLate) continue
    const bookingDate = bankDay(addDays(invoice.dueDate as string, -between(0, 4)))
    if (bookingDate > yesterday) continue
    invoice.paidOn = bookingDate
    payments.push({
      invoice,
      id: id(),
      organizationId: orgId,
      importId,
      bankReference: `BRF${bookingDate.replaceAll('-', '')}${String(payments.length + 1).padStart(5, '0')}`,
      bookingDate,
      amountOre: invoice.totalOre,
      reference: invoice.ocr,
      payerName: invoice.recipientName.split(' och ')[0].toUpperCase(),
      status: 'matched',
      createdAt: new Date(`${yesterday}T08:00:00Z`),
    })
  }
  await insertAll(
    schema.invoice,
    invoices.map(({ lines: _, paidOn: __, ...i }) => i),
  )
  await insertAll(
    schema.invoiceLine,
    invoices.flatMap((i) =>
      i.lines.map((line, index) => ({
        ...line,
        invoiceId: i.id,
        organizationId: orgId,
        position: index + 1,
      })),
    ),
  )
  await db.insert(schema.paymentImport).values({
    id: importId,
    organizationId: orgId,
    fileName: `camt054_${yesterday.replaceAll('-', '')}.xml`,
    messageId: `BGC${yesterday.replaceAll('-', '')}${between(1000, 9999)}`,
    importedByUserId: board.id,
    paymentCount: payments.length,
    duplicateCount: 0,
    totalOre: payments.reduce((sum, p) => sum + p.amountOre, 0),
    createdAt: new Date(`${yesterday}T08:00:00Z`),
  })
  await insertAll(
    schema.payment,
    payments.map(({ invoice: _, ...p }) => p),
  )
  // The ledger: every avi, and each payment matched to the avi it pays.
  const ledger = seedLedger(orgId)
  for (const invoice of invoices) {
    ledger.post(
      {
        date: invoice.issueDate,
        kind: 'invoice',
        description: `Avi ${invoice.number}`,
        invoiceId: invoice.id,
      },
      invoiceEntries(invoice),
      { partyId: invoice.partyId, agreementId: invoice.agreementId },
    )
  }
  for (const p of payments) {
    ledger.post(
      { date: p.bookingDate, kind: 'payment', description: 'Inbetalning', paymentId: p.id },
      paymentEntries(p.id, p.amountOre),
    )
    ledger.post(
      {
        date: p.bookingDate,
        kind: 'allocation',
        description: `Betalning av avi ${p.invoice.number}`,
        invoiceId: p.invoice.id,
        paymentId: p.id,
      },
      allocationEntries(p.id, p.invoice.id, p.amountOre),
      { partyId: p.invoice.partyId, agreementId: p.invoice.agreementId },
    )
  }
  // The board has agreed no reminder fee; Jonas still gets his reminders.
  const reminders = seedReminders(
    orgId,
    ledger,
    invoices
      .filter((i) => !i.paidOn)
      .map((i) => ({
        ...i,
        dueDate: i.dueDate as string,
        recipientEmail: i.recipientEmail ?? null,
        owedOre: i.totalOre,
      })),
    { reminderFeeOre: null, reminderIntervalDays: 10, reminderDueDays: 10 },
    today,
  )
  await ledger.write()
  await insertAll(schema.paymentReminder, reminders)

  console.log(`Seeded ${org.name} (BRF):
  login      ${board.email} (owner)
  data       ${agreements.length - 1} bostadsrätter for ${flats.length} flats (one sold), 1 lease, ${names.length} members
  invoices   ${invoices.length}, payments ${payments.length}`)
}
