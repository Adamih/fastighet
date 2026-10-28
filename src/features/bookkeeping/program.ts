import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { Effect } from 'effect'
import { user } from '#/db/auth-schema'
import {
  bookkeepingExport,
  invoice,
  ledgerEntry,
  organizationSettings,
  payment,
  posting,
} from '#/db/schema'
import { requireFeature } from '#/features/billing/program'
import { periodsOverlap } from '#/features/leases/terms'
import { loadSettings } from '#/features/settings/program'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { CurrentUser } from '#/server/services'
import { today } from '#/server/today'
import { type AccountKey, accountKeys, accountPlan, defaultAccounts } from './accounts'
import type { ExportPeriodInput, UpdateBookkeepingSettingsInput } from './schemas'
import { accountTotals, encodePc8, financialYear, type SiePosting, sieText, vouchers } from './sie'

// The SIE export of the ledger, and the account numbers it uses. Exporting is for owners and
// admins (`bookkeeping:read`); changing account numbers needs `bookkeeping:manage`.
const read: Permissions = { bookkeeping: ['read'] }
const manage: Permissions = { bookkeeping: ['manage'] }

export const getBookkeepingSettings = Effect.gen(function* () {
  yield* requirePermission(read)
  const row = yield* orgQuery((db, organizationId) =>
    db.query.organizationSettings.findFirst({
      columns: { financialYearStartMonth: true, bookkeepingAccounts: true },
      where: eq(organizationSettings.organizationId, organizationId),
    }),
  )
  const plan = accountPlan(row?.bookkeepingAccounts ?? null)
  return {
    financialYearStartMonth: row?.financialYearStartMonth ?? 1,
    accounts: plan,
    defaults: defaultAccounts,
  }
})

export const updateBookkeepingSettings = (input: UpdateBookkeepingSettingsInput) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    yield* requireFeature('bookkeeping')
    // Only numbers that differ from BAS are stored, so a later change of defaults reaches them.
    const custom = Object.fromEntries(
      accountKeys.flatMap((key: AccountKey) => {
        const number = input.accounts[key].trim()
        return number === defaultAccounts[key].number ? [] : [[key, number]]
      }),
    )
    const values = {
      financialYearStartMonth: Number(input.financialYearStartMonth),
      bookkeepingAccounts: Object.keys(custom).length > 0 ? JSON.stringify(custom) : null,
    }
    yield* orgQuery((db, organizationId) =>
      db
        .insert(organizationSettings)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: organizationSettings.organizationId, set: values }),
    )
    return yield* getBookkeepingSettings
  })

/** The postings in the period with their entries, and texts naming the avi or the payer. */
const postingsIn = (period: ExportPeriodInput) =>
  Effect.gen(function* () {
    const rows = yield* orgQuery((db, organizationId) =>
      db
        .select({
          posting,
          entry: ledgerEntry,
          recipientName: invoice.recipientName,
          payerName: payment.payerName,
        })
        .from(posting)
        .innerJoin(ledgerEntry, eq(ledgerEntry.postingId, posting.id))
        .leftJoin(invoice, eq(invoice.id, posting.invoiceId))
        .leftJoin(payment, eq(payment.id, posting.paymentId))
        .where(
          and(
            eq(posting.organizationId, organizationId),
            gte(posting.date, period.fromDate),
            lte(posting.date, period.toDate),
          ),
        ),
    )
    const byPosting = new Map<string, SiePosting & { entries: SiePosting['entries'][number][] }>()
    for (const row of rows) {
      const p = row.posting
      let item = byPosting.get(p.id)
      if (!item) {
        const who = row.recipientName ?? row.payerName
        item = {
          id: p.id,
          date: p.date,
          kind: p.kind,
          description: who ? `${p.description}, ${who}` : p.description,
          createdAt: p.createdAt.getTime(),
          entries: [],
        }
        byPosting.set(p.id, item)
      }
      item.entries.push({
        account: row.entry.account,
        amountOre: row.entry.amountOre,
        chargeKind: row.entry.chargeKind,
        vatRatePercent: row.entry.vatRatePercent,
      })
    }
    return [...byPosting.values()]
  })

const checkPeriod = (period: ExportPeriodInput) =>
  period.fromDate > period.toDate
    ? Effect.fail(new Conflict({ message: 'Perioden slutar före den börjar' }))
    : Effect.void

/** Earlier exports whose periods overlap this one; importing them both would duplicate. */
const overlapping = (period: ExportPeriodInput) =>
  Effect.gen(function* () {
    const exports = yield* listExportRows
    return exports.filter((e) =>
      periodsOverlap(
        { start: e.fromDate, end: e.toDate },
        { start: period.fromDate, end: period.toDate },
      ),
    )
  })

const listExportRows = orgQuery((db, organizationId) =>
  db
    .select({
      id: bookkeepingExport.id,
      fromDate: bookkeepingExport.fromDate,
      toDate: bookkeepingExport.toDate,
      voucherCount: bookkeepingExport.voucherCount,
      createdAt: bookkeepingExport.createdAt,
      exportedBy: user.name,
    })
    .from(bookkeepingExport)
    .leftJoin(user, eq(user.id, bookkeepingExport.exportedByUserId))
    .where(eq(bookkeepingExport.organizationId, organizationId))
    .orderBy(desc(bookkeepingExport.createdAt))
    .limit(20),
)

/** What the export for a period will contain: vouchers per series and totals per account. */
export const previewExport = (period: ExportPeriodInput) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    yield* checkPeriod(period)
    const { accounts } = yield* getBookkeepingSettings
    const list = vouchers(yield* postingsIn(period), accounts)
    return {
      voucherCount: list.length,
      series: {
        F: list.filter((v) => v.series === 'F').length,
        K: list.filter((v) => v.series === 'K').length,
        B: list.filter((v) => v.series === 'B').length,
      },
      totals: accountTotals(list),
      overlapping: yield* overlapping(period),
    }
  })

/** Bytes as base64, in chunks so large files don't overflow the call stack. */
const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * The SIE file for a period, as base64 PC8 bytes with its file name. Each export is recorded,
 * so a later export of an overlapping period can be warned about.
 */
export const exportSie = (period: ExportPeriodInput) =>
  Effect.gen(function* () {
    yield* requirePermission(read)
    yield* requireFeature('bookkeeping')
    yield* checkPeriod(period)
    const me = yield* CurrentUser
    const seller = yield* loadSettings
    const { accounts, financialYearStartMonth } = yield* getBookkeepingSettings
    const list = vouchers(yield* postingsIn(period), accounts)
    if (list.length === 0) {
      return yield* new Conflict({ message: 'Det finns inget att exportera för perioden' })
    }
    const text = sieText(
      {
        companyName: seller.organizationName,
        organizationNumber: seller.organizationNumber,
        generatedOn: yield* today,
        financialYear: financialYear(period.fromDate, financialYearStartMonth),
      },
      list,
    )
    yield* orgQuery((db, organizationId) =>
      db.insert(bookkeepingExport).values({
        organizationId,
        fromDate: period.fromDate,
        toDate: period.toDate,
        voucherCount: list.length,
        exportedByUserId: me.id,
      }),
    )
    const company = (seller.organizationNumber ?? seller.organizationName)
      .replace(/[^0-9A-Za-z]+/g, '')
      .slice(0, 20)
    return {
      fileName: `fastighet_${company}_${period.fromDate}_${period.toDate}.se`,
      base64: toBase64(encodePc8(text)),
      voucherCount: list.length,
    }
  })

export const listExports = Effect.gen(function* () {
  yield* requirePermission(read)
  return yield* listExportRows
})

export type ExportRow = Effect.Success<typeof listExports>[number]
