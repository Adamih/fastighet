import { isNull } from 'drizzle-orm'
import { Effect, Exit } from 'effect'
import { charge, invoice, paymentReminder } from '#/db/schema'
import { billingAvier } from '#/features/agreements/program'
import { getInvoice } from '#/features/invoicing/program'
import { periodLabel } from '#/features/invoicing/rules'
import { statusFromMoney } from '#/features/ledger/postings'
import { allInvoiceMoney } from '#/features/ledger/program'
import { sellerDetails } from '#/features/settings/seller'
import { documentTerms } from '#/features/settings/terminology'
import { formatSek } from '#/lib/money'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { sendEmail } from '#/server/mail/mailer'
import { inCompany, orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import {
  nextReminderOn,
  type ReminderProblem,
  reminderDueDate,
  reminderFee,
  reminderProblem,
} from './rules'
import { pendingFees, reminderSettings, waiveStatements } from './waivers'

// Payment reminders (påminnelser): who can be reminded, and sending them. A fee is a one-off
// charge on the agreement, billed by its next avi, so sending needs invoice:manage.
const manage: Permissions = { invoice: ['manage'] }

/** The fee the next reminder charges: none on an agreement that has ended, with no next avi. */
const feeFor = (
  settings: Parameters<typeof reminderFee>[0],
  reminders: Parameters<typeof reminderFee>[1],
  agreementEnds: string | null,
  on: string,
) => (agreementEnds !== null && agreementEnds < on ? 0 : reminderFee(settings, reminders))

/**
 * Every overdue avi with what it owes, its reminders so far, and whether it can be reminded
 * today (and the fee that would carry), for the bulk send on the invoice list.
 */
export const reminderCandidates = Effect.gen(function* () {
  yield* requirePermission(manage)
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.invoice.findMany({
      where: inCompany(invoice, organizationId, isNull(invoice.voidedAt)),
      with: {
        reminders: { columns: { sentOn: true, feeOre: true } },
        agreement: { columns: { endDate: true } },
      },
    }),
  )
  const moneyOf = yield* allInvoiceMoney
  const settings = yield* reminderSettings
  const on = yield* today
  return rows.flatMap((row) => {
    const money = moneyOf(row.id)
    const status = statusFromMoney(row, money, on)
    if (status !== 'overdue') return []
    const problem = reminderProblem(
      { status, owedOre: money.owedOre, dueDate: row.dueDate, recipientEmail: row.recipientEmail },
      row.reminders,
      settings,
      on,
    )
    return [
      {
        invoiceId: row.id,
        number: row.number,
        recipientName: row.recipientName,
        owedOre: money.owedOre,
        reminders: row.reminders.length,
        problem,
        nextOn: nextReminderOn(row.dueDate, row.reminders, settings),
        feeOre: problem ? 0 : feeFor(settings, row.reminders, row.agreement.endDate, on),
      },
    ]
  })
}).pipe(Effect.withSpan('reminders.reminderCandidates'))

export type ReminderCandidate = Effect.Success<typeof reminderCandidates>[number]

const problemMessages: Record<ReminderProblem, string> = {
  not_overdue: 'Avin har inte förfallit',
  nothing_owed: 'Avin har inget kvar att betala',
  too_soon: 'Det är för tidigt för nästa påminnelse',
  no_email: 'Mottagaren har ingen e-postadress',
}

/**
 * Sends a reminder for an overdue avi: what is still owed, to pay with the same OCR by a new
 * due date. Its first reminder charges the fee, as a one-off charge the agreement's next avi
 * bills. The email goes first; then the reminder and its fee charge are written in one batch.
 */
export const sendReminder = Effect.fn('reminders.sendReminder')(function* (invoiceId: string) {
  yield* requirePermission(manage)
  const inv = yield* getInvoice(invoiceId)
  const settings = yield* reminderSettings
  const on = yield* today
  const problem = reminderProblem(inv, inv.reminders, settings, on)
  if (problem) return yield* new Conflict({ message: problemMessages[problem] })
  if (!inv.seller.bankgiro || !inv.recipientEmail) {
    return yield* new Conflict({ message: 'Ange bankgironummer under Företagsuppgifter först' })
  }
  const feeOre = feeFor(settings, inv.reminders, inv.agreement.endDate, on)
  const dueDate = reminderDueDate(on, settings)
  const sequence = inv.reminders.length + 1

  yield* sendEmail({
    to: inv.recipientEmail,
    template: 'paymentReminder',
    props: {
      recipientName: inv.recipientName,
      organizationName: inv.seller.organizationName,
      documentName: documentTerms(inv.agreement.kind).invoiceTitle,
      invoiceNumber: inv.number,
      periodLabel: periodLabel({ start: inv.periodStart, end: inv.periodEnd }),
      originalDueDate: inv.dueDate,
      sequence,
      total: formatSek(inv.owedOre),
      fee: feeOre > 0 ? formatSek(feeOre) : null,
      dueDate,
      bankgiro: inv.seller.bankgiro,
      ocr: inv.ocr,
      sellerDetails: sellerDetails(inv.seller, inv.vatOre > 0),
    },
  })

  const recipientEmail = inv.recipientEmail
  const feeChargeId = feeOre > 0 ? crypto.randomUUID() : null
  yield* orgQuery((db, organizationId) => {
    // The charge first: the reminder refers to it.
    const [first, ...rest] = [
      ...(feeChargeId
        ? [
            db.insert(charge).values({
              id: feeChargeId,
              organizationId,
              agreementId: inv.agreementId,
              kind: 'reminder_fee',
              description: `Påminnelseavgift avi ${inv.number}`,
              amountOre: feeOre,
              interval: 'once',
              // A reminder fee is compensation for collecting, not a sale: no VAT.
              vat: false,
              fromDate: on,
            }),
          ]
        : []),
      db.insert(paymentReminder).values({
        organizationId,
        invoiceId: inv.id,
        sequence,
        sentOn: on,
        dueDate,
        owedOre: inv.owedOre,
        feeOre,
        feeChargeId,
        recipientEmail,
      }),
    ]
    return db.batch([first, ...rest])
  })
  return { sequence, feeOre, dueDate }
})

/** Sends reminders for several avier, a few at a time; one failure doesn't stop the others. */
export const sendReminders = Effect.fn('reminders.sendReminders')(function* (
  invoiceIds: readonly string[],
) {
  yield* requirePermission(manage)
  const results = yield* Effect.forEach(
    [...new Set(invoiceIds)],
    (id) => Effect.exit(sendReminder(id)),
    { concurrency: 4 },
  )
  const failedInvoiceIds: string[] = []
  for (const [index, result] of results.entries()) {
    if (Exit.isFailure(result)) {
      failedInvoiceIds.push(invoiceIds[index])
      yield* Effect.logError(result.cause)
    }
  }
  return {
    sent: results.length - failedInvoiceIds.length,
    failed: failedInvoiceIds.length,
    failedInvoiceIds,
  }
})

/**
 * "Stryk avgiften": waives the avi's reminder fee before an avi has billed it. Once billed, it is
 * a line on that avi, corrected with a credit note.
 */
export const waiveReminderFee = Effect.fn('reminders.waiveReminderFee')(function* (
  invoiceId: string,
) {
  yield* requirePermission(manage)
  const inv = yield* getInvoice(invoiceId)
  const fee = (yield* pendingFees([inv.id])).get(inv.id)
  if (!fee) {
    const charged = inv.reminders.find((r) => r.feeChargeId)
    const billed = charged?.feeChargeId
      ? (yield* billingAvier([charged.feeChargeId])).get(charged.feeChargeId)
      : undefined
    return yield* new Conflict({
      message: billed
        ? `Avgiften är redan aviserad på avi ${billed.number}. Kreditera den där.`
        : 'Avin har ingen påminnelseavgift att stryka',
    })
  }
  const on = yield* today
  yield* orgQuery((db, organizationId) =>
    db.batch([...waiveStatements(db, organizationId, fee, 'by_hand', on)]),
  )
})
