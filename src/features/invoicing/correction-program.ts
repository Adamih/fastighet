import { eq, ne, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { agreement, invoice, invoiceLine } from '#/db/schema'
import { billedOnceChargeIds } from '#/features/agreements/program'
import { invoiceEntries } from '#/features/ledger/postings'
import {
  creditBalances,
  livePostings,
  postingStatements,
  reversalStatements,
} from '#/features/ledger/program'
import { loadCompanyDetails } from '#/features/settings/program'
import { stockholmDate } from '#/lib/dates'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { today } from '#/server/today'
import { type ReissueProblem, reissueProblem, type VoidProblem, voidProblem } from './correction'
import { getInvoice } from './program'
import { dueDate, ocrFor } from './rules'
import { type BillingRow, billingDetails, billRow, creditUseStatements } from './run-program'

// Correcting an avi: voiding an unsent, unpaid one, and issuing the corrected avi for a period
// whose avi was voided or fully credited (rules in `correction.ts`).

const manage: Permissions = { invoice: ['manage'] }

const voidProblemMessages: Record<VoidProblem, string> = {
  void: 'Avin är redan makulerad',
  paid: 'En betald avi kan inte makuleras',
  credited: 'En krediterad avi kan inte makuleras. Kreditera resten i stället.',
  sent: 'En skickad avi kan inte makuleras. Kreditera den i stället.',
}

/** Voids an unsent, unpaid invoice that has no credit notes. It keeps its number. */
export const voidInvoice = Effect.fn('invoicing.voidInvoice')(function* (invoiceId: string) {
  yield* requirePermission(manage)
  const inv = yield* getInvoice(invoiceId)
  const problem = voidProblem(inv)
  if (problem) return yield* new Conflict({ message: voidProblemMessages[problem] })
  const voidedAt = new Date(yield* Clock.currentTimeMillis)
  const issued = yield* livePostings({ kinds: ['invoice'], invoiceId: inv.id })
  const creditUsed = yield* livePostings({ kinds: ['credit_use'], invoiceId: inv.id })
  // Voiding reverses the avi's posting, so nothing is owed or booked as income, and gives back
  // any credit used on it.
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db
        .update(invoice)
        .set({ voidedAt })
        .where(inCompany(invoice, organizationId, eq(invoice.id, inv.id))),
      ...reversalStatements(
        db,
        organizationId,
        issued,
        stockholmDate(voidedAt.getTime()),
        () => `Makulering av avi ${inv.number}`,
        'void',
      ),
      ...reversalStatements(
        db,
        organizationId,
        creditUsed,
        stockholmDate(voidedAt.getTime()),
        () => `Tillgodo åter vid makulering av avi ${inv.number}`,
      ),
    ]),
  )
  return yield* getInvoice(inv.id)
})

/** Reissuing reads the lease's current terms, so it also needs to be allowed to read leases. */
const reissue: Permissions = { invoice: ['manage'], lease: ['read'] }

const reissueProblemMessages: Record<ReissueProblem, string> = {
  in_force: 'Avin gäller fortfarande. Makulera eller kreditera den först.',
  already_replaced: 'Det finns redan en avi för perioden',
  no_rent: 'Avtalet har ingen hyra för perioden',
}

/**
 * The corrected avi for a voided or fully credited avi's period: the lease's rent for the period
 * as the lease is now, to the tenant's current details, due by the usual rule from today.
 */
export const previewReissue = Effect.fn('invoicing.previewReissue')(function* (invoiceId: string) {
  yield* requirePermission(reissue)
  const inv = yield* getInvoice(invoiceId)
  const issueDate = yield* today
  const settings = yield* loadCompanyDetails
  const billed: BillingRow = yield* orgQuery((db, organizationId) =>
    db.query.agreement.findFirst({
      where: inCompany(agreement, organizationId, eq(agreement.id, inv.agreementId)),
      with: billingDetails,
    }),
  ).pipe(orNotFound('agreement', inv.agreementId))
  const others = yield* orgQuery((db, organizationId) =>
    db
      .select({
        voidedAt: invoice.voidedAt,
        totalOre: invoice.totalOre,
        creditedOre: invoice.creditedOre,
      })
      .from(invoice)
      .where(
        inCompany(
          invoice,
          organizationId,
          eq(invoice.agreementId, inv.agreementId),
          eq(invoice.periodStart, inv.periodStart),
          ne(invoice.id, inv.id),
        ),
      ),
  )
  const period = { start: inv.periodStart, end: inv.periodEnd }
  // One-off charges on the avi being replaced are billed again on the corrected one.
  const bill = billRow(billed, period, yield* billedOnceChargeIds([billed.id]))
  const problem = reissueProblem(inv, others, bill?.netOre ?? 0)
  return {
    invoiceId: inv.id,
    agreementId: billed.id,
    recipient: bill?.recipient ?? null,
    period,
    lines: bill?.lines ?? [],
    description: bill?.lines[0]?.description ?? '',
    netOre: bill?.netOre ?? 0,
    vatOre: bill?.vatOre ?? 0,
    totalOre: bill?.totalOre ?? 0,
    issueDate,
    dueDate: dueDate(period, issueDate),
    canInvoice: settings.bankgiro !== null,
    problem: problem && reissueProblemMessages[problem],
  }
})

export type ReissuePreview = Effect.Success<ReturnType<typeof previewReissue>>

/**
 * Issues the corrected avi: the next number, linked to the avi it replaces. The unique index on
 * agreement and period stops a second one if two are issued at once.
 */
export const reissueInvoice = Effect.fn('invoicing.reissueInvoice')(function* (invoiceId: string) {
  yield* requirePermission(reissue)
  const preview = yield* previewReissue(invoiceId)
  if (preview.problem) return yield* new Conflict({ message: preview.problem })
  if (!preview.canInvoice) {
    return yield* new Conflict({
      message: 'Ange bankgironummer under Företagsuppgifter innan du skapar avier.',
    })
  }
  const [{ maxNumber }] = yield* orgQuery((db, organizationId) =>
    db
      .select({ maxNumber: sql<number>`coalesce(max(${invoice.number}), 0)` })
      .from(invoice)
      .where(inCompany(invoice, organizationId)),
  )
  const { recipient } = preview
  if (!recipient) return yield* new Conflict({ message: 'Avtalet har ingen hyra för perioden' })
  const number = maxNumber + 1
  const id = crypto.randomUUID()
  const credit = yield* creditBalances([recipient.partyId])
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db.insert(invoice).values({
        id,
        organizationId,
        number,
        ocr: ocrFor(number),
        agreementId: preview.agreementId,
        ...recipient,
        periodStart: preview.period.start,
        periodEnd: preview.period.end,
        issueDate: preview.issueDate,
        dueDate: preview.dueDate,
        netOre: preview.netOre,
        vatOre: preview.vatOre,
        totalOre: preview.totalOre,
        replacesInvoiceId: preview.invoiceId,
      }),
      db.insert(invoiceLine).values(
        preview.lines.map((line, index) => ({
          ...line,
          invoiceId: id,
          organizationId,
          position: index + 1,
        })),
      ),
      ...postingStatements(
        db,
        organizationId,
        { date: preview.issueDate, kind: 'invoice', description: `Avi ${number}`, invoiceId: id },
        invoiceEntries({ id, ...preview }),
        { partyId: recipient.partyId, agreementId: preview.agreementId },
      ),
      ...creditUseStatements(
        db,
        organizationId,
        credit,
        { id, number, totalOre: preview.totalOre, issueDate: preview.issueDate },
        { partyId: recipient.partyId, agreementId: preview.agreementId },
      ),
    ]),
  )
  return { id }
})
