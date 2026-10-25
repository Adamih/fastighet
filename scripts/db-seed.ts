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
import { count, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import * as schema from '#/db/schema'
import { type CreditRequest, draftCreditNote } from '#/features/invoicing/credit'
import {
  dueDate,
  formatBankgiro,
  invoicePeriod,
  ocrFor,
  type Period,
  type RentTerms,
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
import { formatSek } from '#/lib/money'
import { SEED_PASSWORD, SEED_USERS } from './db-seed-constants'

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
  const perStatement = Math.max(1, Math.floor(90 / Object.keys(rows[0]).length))
  for (let i = 0; i < rows.length; i += perStatement) {
    // biome-ignore lint/suspicious/noExplicitAny: one helper for every table's insert type
    await db.insert(table).values(rows.slice(i, i + perStatement) as any)
  }
}

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
  await insertAll(schema.tenant, Object.values(tenants))

  // --- Leases, numbered in the order they were signed.
  const openEnded = (startDate: string, noticePeriodMonths = 3): LeaseTerms => ({
    startDate,
    endDate: null,
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
    units: Unit[]
    terms: LeaseTerms & { noticeDate?: string }
    rentOre: number
    rentInterval: RentTerms['rentInterval']
    invoiceInterval: RentTerms['invoiceInterval']
    vat: boolean
    payer: Payer
  }
  const monthly = { rentInterval: 'monthly', invoiceInterval: 'monthly', vat: false } as const
  const commercial = (startDate: string, endDate: string): LeaseTerms => ({
    startDate,
    endDate,
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
  const leases = seedLeases.map((l, i) => ({ ...l, id: id(), number: i + 1 }))
  await insertAll(
    schema.lease,
    leases.map((l) => ({
      id: l.id,
      organizationId: orgId,
      number: l.number,
      tenantId: tenants[l.tenant].id,
      startDate: l.terms.startDate,
      endDate: l.terms.endDate,
      extensionMonths: l.terms.extensionMonths,
      noticePeriodMonths: l.terms.noticePeriodMonths,
      moveOutDate: l.terms.moveOutDate,
      noticeDate: l.terms.noticeDate ?? null,
      rentOre: l.rentOre,
      rentInterval: l.rentInterval,
      invoiceInterval: l.invoiceInterval,
      vat: l.vat,
      createdAt: new Date(`${addDays(l.terms.startDate, -between(20, 45))}T09:00:00Z`),
    })),
  )
  await insertAll(
    schema.leaseUnit,
    leases.flatMap((l) =>
      l.units.map((u) => ({ leaseId: l.id, unitId: u.id, organizationId: orgId })),
    ),
  )

  // --- Invoice runs: one a month for the last eight months and the coming one, each issued 20
  // days before its month starts (only runs whose issue date has passed). Built exactly like
  // "Skapa avier", so each lease is invoiced its rent for the period.
  type Invoice = typeof schema.invoice.$inferInsert & {
    id: string
    lease: (typeof leases)[number]
    line: string
    /** Credit notes against it, so a payment only subtracts those issued before it was made. */
    credits: { issueDate: string; totalOre: number }[]
  }
  const invoices: Invoice[] = []
  const invoiceFor = (
    lease: (typeof leases)[number],
    period: Period,
    issueDate: string,
    terms: RentTerms,
  ) => {
    const netOre = rentForPeriod(terms, period)
    if (netOre <= 0) return
    const tenant = tenants[lease.tenant]
    const vatOre = vatFor(netOre, lease.vat)
    const number = invoices.length + 1
    invoices.push({
      id: id(),
      lease,
      organizationId: orgId,
      number,
      ocr: ocrFor(number),
      leaseId: lease.id,
      tenantId: tenant.id,
      recipientName: tenant.name,
      recipientStreetAddress: tenant.streetAddress,
      recipientPostalCode: tenant.postalCode,
      recipientCity: tenant.city,
      recipientEmail: tenant.email,
      periodStart: period.start,
      periodEnd: period.end,
      issueDate,
      dueDate: dueDate(period, issueDate),
      netOre,
      vatOre,
      totalOre: netOre + vatOre,
      sentAt: tenant.email ? new Date(`${issueDate}T07:${between(10, 50)}:00Z`) : null,
      createdAt: new Date(`${issueDate}T07:00:00Z`),
      line: rentLineDescription(lease.units, period),
      credits: [],
    })
  }
  const termsOf = (l: (typeof leases)[number]): RentTerms => ({ ...l.terms, ...l })
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
          ? { ...termsOf(lease), moveOutDate: null, noticeDate: null }
          : termsOf(lease)
      const before = invoices.length
      invoiceFor(lease, period, issueDate, asSigned)
      if (lease.key === 'oskar' && offset === 0 && invoices.length > before) {
        oskarCredited = invoices.at(-1)
      }
    }
  }
  await insertAll(
    schema.invoice,
    invoices.map(({ lease: _, line: __, ...i }) => i),
  )
  await insertAll(
    schema.invoiceLine,
    invoices.map((i) => ({
      invoiceId: i.id,
      organizationId: orgId,
      position: 1,
      description: i.line,
      netOre: i.netOre,
      vatRatePercent: i.vatOre > 0 ? VAT_RATE_PERCENT : 0,
      vatOre: i.vatOre,
    })),
  )

  // --- Credit notes, in date order. Each is built with the "Kreditera" rule and lowers what is
  // still owed on its invoice.
  const creditNotes: (typeof schema.creditNote.$inferInsert & {
    lines: ReturnType<typeof draftCreditNote> & { ok: true }
  })[] = []
  const credit = (invoice: Invoice, request: CreditRequest, reason: string, issueDate: string) => {
    const result = draftCreditNote(
      {
        number: invoice.number,
        totalOre: invoice.totalOre,
        creditedOre: invoice.creditedOre ?? 0,
        voidedAt: null,
        lines: [
          {
            description: invoice.line,
            netOre: invoice.netOre,
            vatRatePercent: invoice.vatOre > 0 ? VAT_RATE_PERCENT : 0,
            vatOre: invoice.vatOre,
          },
        ],
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
  }
  const latest = (key: string, monthsBack = 0) =>
    invoices.filter((i) => i.lease.key === key).at(-1 - monthsBack)
  // 1. The office rent was raised too early; three months back is refunded (already paid).
  const office = latest('redovisning', 3)
  if (office) {
    credit(
      office,
      { kind: 'amount', netOre: 150_000 },
      'Hyran höjdes en månad för tidigt',
      addDays(office.dueDate as string, 12),
    )
  }
  // 2. Oskar's last avi, for the month after he moved out. Credited the day the earlier
  // move-out was agreed, before the avi fell due, so he never paid it.
  if (oskarCredited) {
    credit(
      oskarCredited,
      { kind: 'rest' },
      'Avflyttning tidigarelagd enligt överenskommelse',
      oskarTerms.noticeDate,
    )
  }
  // 3. Anna's broken dishwasher took three weeks to replace.
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
      bookingDate: date,
      amountOre: due,
      reference: invoice.ocr,
      payerName: invoice.recipientName.toUpperCase(),
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
    if (owed <= 0) continue
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
        id: id(),
        organizationId: orgId,
        importId,
        bankReference: `${p.bookingDate.replaceAll('-', '')}${String(++bankSequence).padStart(6, '0')}`,
        bookingDate: p.bookingDate,
        amountOre: p.amountOre,
        reference: p.reference,
        payerName: p.payerName,
        status: p.status,
        note: p.note,
        invoiceId: p.invoice?.id ?? null,
        marksInvoicePaid: p.marksInvoicePaid,
        createdAt: new Date(`${importedOn}T08:00:00Z`),
      })),
    )
  }

  // Paid dates and credited totals were settled above; write them onto the invoices.
  for (const invoice of invoices) {
    if (!invoice.paidOn && !invoice.creditedOre) continue
    await db
      .update(schema.invoice)
      .set({ paidOn: invoice.paidOn ?? null, creditedOre: invoice.creditedOre ?? 0 })
      .where(eq(schema.invoice.id, invoice.id))
  }
  for (const { lines, ...note } of creditNotes) {
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

  const open = invoices.filter((i) => !i.paidOn && i.totalOre > (i.creditedOre ?? 0))
  console.log(`Seeded ${org.name}:
  logins     ${owner.email} (owner), ${member.email} (member). Password: SEED_PASSWORD in scripts/db-seed-constants.ts
  bankgiro   ${settings.bankgiro}, org.nr ${settings.organizationNumber}
  data       ${Object.keys(properties).length} properties, ${Object.keys(units).length} units, ${Object.keys(tenants).length} tenants, ${leases.length} leases
  invoices   ${invoices.length} (${open.length} open), ${creditNotes.length} credit notes
  payments   ${payments.length} in ${imports.size} bank files (${payments.filter((p) => p.status !== 'matched').length} need attention or ignored)`)
}
