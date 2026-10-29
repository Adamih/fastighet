import { desc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  agreement,
  creditNote,
  invoice,
  invoiceLine,
  ledgerEntry,
  organizationSettings,
  paymentReminder,
  posting,
} from '#/db/schema'
import { statusFromMoney } from '#/features/ledger/postings'
import { creditBalancesIn, invoiceMoneyIn } from '#/features/ledger/program'
import { documentTerms } from '#/features/settings/terminology'
import { NotFound } from '#/server/errors'
import { inCompany, portalQuery } from '#/server/scoped'
import { PortalCompany } from '#/server/services'
import { today } from '#/server/today'
import { visibleAgreementIds } from './scope'

// Avier, payments and balance in Mina sidor: the avier of the agreements the person sees
// (`visibleAgreementIds`; every party on an agreement sees all of its avier), with their money
// from the ledger like the app's views.

/** The visible agreements' avier, newest first, with what is owed and their status. */
export const portalInvoices = Effect.gen(function* () {
  const ids = yield* visibleAgreementIds
  if (ids.length === 0) return []
  const rows = yield* portalQuery((db, scope) =>
    db
      .select({
        id: invoice.id,
        number: invoice.number,
        agreementId: invoice.agreementId,
        agreementKind: agreement.kind,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        totalOre: invoice.totalOre,
        voidedAt: invoice.voidedAt,
      })
      .from(invoice)
      .innerJoin(agreement, eq(agreement.id, invoice.agreementId))
      .where(inCompany(invoice, scope.organizationId, inArray(invoice.agreementId, ids)))
      .orderBy(desc(invoice.number)),
  )
  const company = yield* PortalCompany
  const moneyOf = yield* invoiceMoneyIn(
    company.id,
    rows.map((r) => r.id),
  )
  const on = yield* today
  return rows.map(({ voidedAt, ...row }) => {
    const money = moneyOf(row.id)
    return {
      ...row,
      title: documentTerms(row.agreementKind).invoiceTitle,
      owedOre: Math.max(0, money.owedOre),
      creditUsedOre: money.creditUsedOre,
      paidOn: money.paidOn,
      status: statusFromMoney({ voidedAt, dueDate: row.dueDate }, money, on),
    }
  })
}).pipe(Effect.withSpan('portal.portalInvoices'))

export type PortalInvoice = Effect.Success<typeof portalInvoices>[number]

/** How to pay the company: its bankgiro, shown with each avi's OCR. */
const companyBankgiro = portalQuery((db, scope) =>
  db
    .select({ bankgiro: organizationSettings.bankgiro })
    .from(organizationSettings)
    .where(inCompany(organizationSettings, scope.organizationId)),
).pipe(Effect.map(([row]) => row?.bankgiro ?? null))

/**
 * One avi of a visible agreement: its lines, how to pay it, reminders, late interest, credit
 * notes and the payments on it. Anything else is not found.
 */
export const portalInvoice = Effect.fn('portal.portalInvoice')(function* (invoiceId: string) {
  const ids = yield* visibleAgreementIds
  const row =
    ids.length === 0
      ? undefined
      : yield* portalQuery((db, scope) =>
          db.query.invoice.findFirst({
            where: inCompany(
              invoice,
              scope.organizationId,
              eq(invoice.id, invoiceId),
              inArray(invoice.agreementId, ids),
            ),
            with: {
              agreement: { columns: { kind: true, number: true } },
              lines: { orderBy: invoiceLine.position },
              reminders: {
                columns: {
                  sequence: true,
                  sentOn: true,
                  dueDate: true,
                  feeOre: true,
                  feeWaivedOn: true,
                },
                orderBy: paymentReminder.sequence,
              },
              lateInterest: {
                columns: { fromDate: true, toDate: true, days: true, amountOre: true },
              },
              creditNotes: {
                columns: { number: true, issueDate: true, totalOre: true },
                orderBy: creditNote.number,
              },
            },
          }),
        )
  if (!row) return yield* new NotFound({ entity: 'invoice', id: invoiceId })
  const company = yield* PortalCompany
  const money = (yield* invoiceMoneyIn(company.id, [row.id]))(row.id)
  const payments = yield* portalQuery((db, scope) =>
    db
      .select({
        id: posting.id,
        date: posting.date,
        kind: posting.kind,
        reversesPostingId: posting.reversesPostingId,
        amountOre: ledgerEntry.amountOre,
      })
      .from(ledgerEntry)
      .innerJoin(posting, eq(posting.id, ledgerEntry.postingId))
      .where(
        inCompany(
          ledgerEntry,
          scope.organizationId,
          eq(ledgerEntry.account, 'receivable'),
          eq(ledgerEntry.invoiceId, row.id),
          inArray(posting.kind, ['allocation', 'manual_payment', 'credit_use']),
        ),
      ),
  )
  // Payments still standing: neither undone nor an undo.
  const undone = new Set(
    payments.flatMap((p) => (p.reversesPostingId ? [p.reversesPostingId] : [])),
  )
  const standing = payments
    .filter((p) => !p.reversesPostingId && !undone.has(p.id))
    .map((p) => ({ id: p.id, date: p.date, kind: p.kind, amountOre: -p.amountOre }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const { agreement: billed, voidedAt, ...rest } = row
  return {
    id: rest.id,
    number: rest.number,
    title: documentTerms(billed.kind).invoiceTitle,
    agreementNumber: billed.number,
    agreementKind: billed.kind,
    periodStart: rest.periodStart,
    periodEnd: rest.periodEnd,
    issueDate: rest.issueDate,
    dueDate: rest.dueDate,
    recipientName: rest.recipientName,
    netOre: rest.netOre,
    vatOre: rest.vatOre,
    totalOre: rest.totalOre,
    lines: rest.lines.map((l) => ({
      position: l.position,
      description: l.description,
      netOre: l.netOre,
      vatRatePercent: l.vatRatePercent,
      vatOre: l.vatOre,
    })),
    reminders: rest.reminders,
    lateInterest: rest.lateInterest ?? null,
    creditNotes: rest.creditNotes,
    payments: standing,
    owedOre: Math.max(0, money.owedOre),
    paidOre: money.paidOre,
    creditUsedOre: money.creditUsedOre,
    creditedOre: money.creditedOre,
    paidOn: money.paidOn,
    status: statusFromMoney({ voidedAt, dueDate: rest.dueDate }, money, yield* today),
    pay: { bankgiro: yield* companyBankgiro, ocr: rest.ocr },
  }
})

export type PortalInvoiceDetail = Effect.Success<ReturnType<typeof portalInvoice>>

/**
 * The person's balance in the company in focus: what their visible avier still owe, what is
 * overdue, their parties' credit balance (tillgodo), and the latest payments.
 */
export const portalBalance = Effect.gen(function* () {
  const invoices = yield* portalInvoices
  const company = yield* PortalCompany
  const credit = yield* creditBalancesIn(company.id, company.partyIds)
  const open = invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue')
  const latestPaid = invoices
    .filter((i) => i.paidOn)
    .sort((a, b) => (b.paidOn ?? '').localeCompare(a.paidOn ?? ''))
    .slice(0, 3)
  return {
    owedOre: open.reduce((sum, i) => sum + i.owedOre, 0),
    overdueOre: open.filter((i) => i.status === 'overdue').reduce((sum, i) => sum + i.owedOre, 0),
    creditOre: [...credit.values()].reduce((sum, c) => sum + Math.max(0, c), 0),
    nextDue: [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null,
    latestPaid,
  }
}).pipe(Effect.withSpan('portal.portalBalance'))
