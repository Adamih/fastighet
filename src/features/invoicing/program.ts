import { desc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import { creditNote, invoice, invoiceLine, payment, paymentReminder } from '#/db/schema'
import { billingAvier } from '#/features/agreements/program'
import { type InvoiceMoney, statusFromMoney } from '#/features/ledger/postings'
import { allInvoiceMoney, invoiceMoneyFor, livePostings } from '#/features/ledger/program'
import { loadCompanyDetails } from '#/features/settings/program'
import type { Permissions } from '#/lib/permissions'
import { hasPermission, requirePermission } from '#/server/authorize'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { today } from '#/server/today'
import { matchesFilter } from './overview'
import type { ListInvoicesInput } from './schemas'

// Reading invoices: the list, and one avi with its money, payments and what billed its fees.
// Issuing, sending, payments by hand, credit notes and corrections are in the `*-program.ts` files
// next to this one.

const read: Permissions = { invoice: ['read'] }

/** An avi with its money from the ledger: owed, paid, credited, to pay back, and its status. */
const toView = <R extends typeof invoice.$inferSelect>(
  row: R,
  money: InvoiceMoney,
  on: string,
) => ({
  ...row,
  ...money,
  status: statusFromMoney(row, money, on),
})

export const listInvoices = Effect.fn('invoicing.listInvoices')(function* (
  input: ListInvoicesInput,
) {
  yield* requirePermission(read)
  // The lease's current units label each row; only for those who may read leases and units.
  const showUnits = yield* hasPermission({ lease: ['read'], property: ['read'] })
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.invoice.findMany({
      where: inCompany(
        invoice,
        organizationId,
        input.agreementId ? eq(invoice.agreementId, input.agreementId) : undefined,
      ),
      orderBy: desc(invoice.number),
      with: {
        reminders: { columns: { sentOn: true } },
        agreement: {
          columns: { id: true },
          with: {
            units: {
              with: {
                unit: {
                  columns: { kind: true, label: true },
                  with: { property: { columns: { designation: true } } },
                },
              },
            },
          },
        },
      },
    }),
  )
  const on = yield* today
  const moneyOf = yield* allInvoiceMoney
  const views = rows.map(({ agreement: billed, reminders, ...row }) => ({
    ...toView(row, moneyOf(row.id), on),
    /** The latest reminder sent for the avi, if any. */
    lastRemindedOn:
      reminders
        .map((r) => r.sentOn)
        .sort()
        .at(-1) ?? null,
    units: showUnits
      ? billed.units.map(({ unit }) => ({
          kind: unit.kind,
          label: unit.label,
          designation: unit.property.designation,
        }))
      : [],
  }))
  return views.filter((v) => matchesFilter(v.status, input.filter))
})

export const getInvoice = Effect.fn('invoicing.getInvoice')(function* (invoiceId: string) {
  yield* requirePermission(read)
  const row = yield* orgQuery((db, organizationId) =>
    db.query.invoice.findFirst({
      where: inCompany(invoice, organizationId, eq(invoice.id, invoiceId)),
      with: {
        lines: { orderBy: invoiceLine.position },
        agreement: { columns: { id: true, number: true, kind: true, endDate: true } },
        creditNotes: {
          columns: {
            id: true,
            number: true,
            issueDate: true,
            totalOre: true,
            reason: true,
          },
          orderBy: creditNote.number,
        },
        reminders: { orderBy: paymentReminder.sequence },
        lateInterest: {
          columns: { chargeId: true, fromDate: true, toDate: true, days: true, amountOre: true },
        },
        replaces: { columns: { id: true, number: true } },
        replacedBy: {
          columns: { id: true, number: true, issueDate: true },
          orderBy: invoice.number,
        },
      },
    }),
  ).pipe(orNotFound('invoice', invoiceId))
  const seller = yield* loadCompanyDetails
  const money = (yield* invoiceMoneyFor([row.id]))(row.id)
  // Payments on the avi, from the ledger: bank payments matched to it and payments registered
  // by hand. Listed only for those who may read payments.
  const payments = (yield* hasPermission({ payment: ['read'] }))
    ? yield* invoicePayments(row.id)
    : []
  // Late interest and reminder fees are billed by a later avi of the agreement; which one,
  // once it has.
  const interest = row.lateInterest
  const billed = yield* billingAvier([
    interest?.chargeId ?? null,
    ...row.reminders.map((r) => r.feeChargeId),
  ])
  const billedBy = (chargeId: string | null) => {
    const avi = chargeId ? billed.get(chargeId) : undefined
    return avi && !avi.voided ? { id: avi.id, number: avi.number } : null
  }
  return {
    ...toView(row, money, yield* today),
    reminders: row.reminders.map((r) => ({ ...r, feeBilledBy: billedBy(r.feeChargeId) })),
    lateInterest: interest ? { ...interest, billedBy: billedBy(interest.chargeId) } : null,
    payments,
    seller,
  }
})

export type InvoiceView = Effect.Success<ReturnType<typeof getInvoice>>

/** The live payments on an avi: matched bank payments (with the bank's details) and by hand. */
const invoicePayments = (invoiceId: string) =>
  Effect.gen(function* () {
    const live = yield* livePostings({ kinds: ['allocation', 'manual_payment'], invoiceId })
    const paymentIds = live.flatMap((l) => (l.posting.paymentId ? [l.posting.paymentId] : []))
    const bank =
      paymentIds.length === 0
        ? []
        : yield* orgQuery((db, organizationId) =>
            db
              .select({
                id: payment.id,
                payerName: payment.payerName,
                status: payment.status,
              })
              .from(payment)
              .where(inCompany(payment, organizationId, inArray(payment.id, paymentIds))),
          )
    return live
      .map(({ posting: p, entries }) => {
        const receivable = entries.find((e) => e.account === 'receivable')
        const fromBank = bank.find((b) => b.id === p.paymentId) ?? null
        return {
          id: p.id,
          date: p.date,
          /** What this payment settled on the avi (a bank payment may be split). */
          amountOre: -(receivable?.amountOre ?? 0),
          paymentId: p.paymentId,
          payerName: fromBank?.payerName ?? null,
          status: fromBank?.status ?? null,
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  })
