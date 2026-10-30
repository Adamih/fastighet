import { eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  agreement,
  type agreementParty,
  type agreementUnit,
  type charge,
  invoice,
  invoiceLine,
  type party,
} from '#/db/schema'
import { billFor } from '#/features/agreements/billing'
import { billedOnceChargeIds } from '#/features/agreements/program'
import { creditUseEntries, invoiceEntries } from '#/features/ledger/postings'
import { creditBalances, postingStatements } from '#/features/ledger/program'
import { loadCompanyDetails } from '#/features/settings/program'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { forEachBestEffort } from '#/server/best-effort'
import { Conflict } from '#/server/errors'
import { inCompany, orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { sellerToIssue } from './program'
import { dueDate, invoicePeriod, ocrFor, type Period } from './rules'
import type { CreateInvoiceRunInput } from './schemas'
import { emailInvoice } from './send-program'

// Invoice runs: the avier a month's run issues, numbered without gaps, with the party's credit
// balance used on each. Corrected avier (correction-program.ts) reuse the billing helpers here.

/**
 * A run reads every agreement (leases and bostadsrätter alike); seeing agreements is the lease
 * permission, so it also needs that.
 */
const runInvoices: Permissions = { invoice: ['manage'], lease: ['read'] }

/**
 * The statements that use the party's credit balance (tillgodo) on a new avi, in the batch that
 * issues it: as much as the avi's total allows. `credit` tracks what is left per party during a
 * run, so two avier to the same party don't use the same credit twice.
 */
export function creditUseStatements(
  db: Parameters<Parameters<typeof orgQuery>[0]>[0],
  organizationId: string,
  credit: Map<string, number>,
  avi: { id: string; number: number; totalOre: number; issueDate: string },
  owner: { partyId: string; agreementId: string },
) {
  const available = credit.get(owner.partyId) ?? 0
  const amountOre = Math.min(available, avi.totalOre)
  if (amountOre <= 0) return []
  credit.set(owner.partyId, available - amountOre)
  return postingStatements(
    db,
    organizationId,
    {
      date: avi.issueDate,
      kind: 'credit_use',
      description: `Tillgodo avräknat på avi ${avi.number}`,
      invoiceId: avi.id,
    },
    creditUseEntries(avi.id, amountOre),
    owner,
  )
}

/**
 * What billing reads from an agreement: its charges (the lines), parties (the recipient) and
 * units (the line text), each with the dates they apply.
 */
export const billingDetails = {
  charges: true,
  parties: { with: { party: true } },
  units: { with: { unit: { with: { property: { columns: { designation: true } } } } } },
} as const

export type BillingRow = typeof agreement.$inferSelect & {
  charges: (typeof charge.$inferSelect)[]
  parties: (typeof agreementParty.$inferSelect & { party: typeof party.$inferSelect })[]
  units: (typeof agreementUnit.$inferSelect & {
    unit: { label: string; property: { designation: string } }
  })[]
}

/** The avi an agreement gets for a period (see `billFor`), or null when nothing is billed. */
export const billRow = (a: BillingRow, period: Period, billedOnce: ReadonlySet<string>) =>
  billFor(
    {
      ...a,
      units: a.units.map(({ unit, ...u }) => ({
        ...u,
        designation: unit.property.designation,
        label: unit.label,
      })),
    },
    period,
    billedOnce,
  )

/** What a run for `month` would invoice. Agreements already invoiced for the period are flagged. */
export const previewInvoiceRun = Effect.fn('invoicing.previewInvoiceRun')(function* (
  month: string,
) {
  yield* requirePermission(runInvoices)
  const issueDate = yield* today
  const settings = yield* loadCompanyDetails

  const agreements: BillingRow[] = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findMany({
      where: inCompany(agreement, organizationId),
      orderBy: agreement.number,
      with: billingDetails,
    }),
  )
  // Every period in a run starts on the first of the month, whatever the invoice interval.
  // Any avi for the period counts, voided and credited ones too: a run never re-issues a period
  // someone corrected. A corrected avi is issued from the avi it replaces instead.
  const periodStart = `${month}-01`
  const invoiced = yield* orgQuery((db, organizationId) =>
    db
      .select({ agreementId: invoice.agreementId })
      .from(invoice)
      .where(inCompany(invoice, organizationId, eq(invoice.periodStart, periodStart))),
  )
  const alreadyInvoiced = new Set(invoiced.map((i) => i.agreementId))
  const billedOnce = yield* billedOnceChargeIds(agreements.map((a) => a.id))

  const rows = agreements.flatMap((a) => {
    const period = invoicePeriod(month, a.invoiceInterval)
    if (!period) return []
    const bill = billRow(a, period, billedOnce)
    if (!bill) return []
    return [
      {
        agreementId: a.id,
        agreementNumber: a.number,
        recipient: bill.recipient,
        period,
        lines: bill.lines,
        /** The first line, to name the avi in previews. */
        description: bill.lines[0].description,
        netOre: bill.netOre,
        vatOre: bill.vatOre,
        totalOre: bill.totalOre,
        dueDate: dueDate(period, issueDate),
        alreadyInvoiced: alreadyInvoiced.has(a.id),
      },
    ]
  })

  return { month, issueDate, canInvoice: settings.bankgiro !== null, rows }
})

export type InvoiceRunPreview = Effect.Success<ReturnType<typeof previewInvoiceRun>>

/**
 * D1 caps statements per batch; each avi needs four (avi, lines, posting, entries). Each chunk is
 * atomic on its own.
 */
const CHUNK_SIZE = 12

export const createInvoiceRun = Effect.fn('invoicing.createInvoiceRun')(function* (
  input: CreateInvoiceRunInput,
) {
  yield* requirePermission(runInvoices)
  const preview = yield* previewInvoiceRun(input.month)
  if (!preview.canInvoice) {
    return yield* new Conflict({
      message: 'Ange bankgironummer under Företagsuppgifter innan du skapar avier.',
    })
  }
  const pending = preview.rows.filter((r) => !r.alreadyInvoiced)
  const credit = yield* creditBalances(pending.map((r) => r.recipient.partyId))
  const seller = yield* sellerToIssue

  const [{ maxNumber }] = yield* orgQuery((db, organizationId) =>
    db
      .select({ maxNumber: sql<number>`coalesce(max(${invoice.number}), 0)` })
      .from(invoice)
      .where(inCompany(invoice, organizationId)),
  )

  // Numbers are allocated up front so they run without gaps. A concurrent run makes a chunk fail
  // on the unique number index; nothing partial is written and running again is safe.
  const createdIds: string[] = []
  for (let offset = 0; offset < pending.length; offset += CHUNK_SIZE) {
    const chunk = pending.slice(offset, offset + CHUNK_SIZE).map((row, i) => {
      const number = maxNumber + offset + i + 1
      return { row, number, id: crypto.randomUUID() }
    })
    yield* orgQuery((db, organizationId) => {
      const statements = chunk.flatMap(({ row, number, id }) => [
        db.insert(invoice).values({
          id,
          organizationId,
          number,
          ocr: ocrFor(number),
          agreementId: row.agreementId,
          ...row.recipient,
          seller,
          periodStart: row.period.start,
          periodEnd: row.period.end,
          issueDate: preview.issueDate,
          dueDate: row.dueDate,
          netOre: row.netOre,
          vatOre: row.vatOre,
          totalOre: row.totalOre,
        }),
        db.insert(invoiceLine).values(
          row.lines.map((line, index) => ({
            ...line,
            invoiceId: id,
            organizationId,
            position: index + 1,
          })),
        ),
        ...postingStatements(
          db,
          organizationId,
          {
            date: preview.issueDate,
            kind: 'invoice',
            description: `Avi ${number}`,
            invoiceId: id,
          },
          invoiceEntries({ id, ...row }),
          { partyId: row.recipient.partyId, agreementId: row.agreementId },
        ),
        ...creditUseStatements(
          db,
          organizationId,
          credit,
          { id, number, totalOre: row.totalOre, issueDate: preview.issueDate },
          { partyId: row.recipient.partyId, agreementId: row.agreementId },
        ),
      ])
      const [first, ...rest] = statements
      return db.batch([first, ...rest])
    })
    createdIds.push(...chunk.map((c) => c.id))
  }

  const withEmail = pending.filter((r) => r.recipient.recipientEmail).length
  const emails =
    input.send && createdIds.length > 0
      ? yield* forEachBestEffort(createdIds, (id) => emailInvoice(id, { skipWithoutEmail: true }), {
          label: 'Could not email avi',
          concurrency: 4,
        })
      : { succeeded: [], failed: [] }
  // emailInvoice gives false for an avi without an email address.
  const sent = emails.succeeded.filter((e) => e.value).length
  const failedInvoiceIds = emails.failed

  return {
    created: createdIds.length,
    skipped: preview.rows.length - pending.length,
    sent,
    failed: failedInvoiceIds.length,
    failedInvoiceIds,
    withoutEmail: pending.length - withEmail,
  }
})
