import { and, eq, isNull } from 'drizzle-orm'
import { Effect, Exit } from 'effect'
import { invoice, paymentReminder } from '#/db/schema'
import { getInvoice } from '#/features/invoicing/program'
import { periodLabel } from '#/features/invoicing/rules'
import { reminderFeeEntries, statusFromMoney } from '#/features/ledger/postings'
import { allInvoiceMoney, postingStatements } from '#/features/ledger/program'
import { loadSettings } from '#/features/settings/program'
import { sellerDetails } from '#/features/settings/seller'
import { documentTerms } from '#/features/settings/terminology'
import { formatSek } from '#/lib/money'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { sendEmail } from '#/server/mail/mailer'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import {
  nextReminderOn,
  type ReminderProblem,
  reminderDueDate,
  reminderFee,
  reminderProblem,
} from './rules'

// Payment reminders (påminnelser): who can be reminded, and sending them. Sending changes what
// an avi owes when there is a fee, so it needs invoice:manage.
const manage: Permissions = { invoice: ['manage'] }

const reminderSettings = Effect.map(loadSettings, (s) => ({
  reminderFeeOre: s.reminderFeeOre,
  reminderIntervalDays: s.reminderIntervalDays,
  reminderDueDays: s.reminderDueDays,
}))

/**
 * Every overdue avi with what it owes, its reminders so far, and whether it can be reminded
 * today (and the fee that would carry), for the bulk send on the invoice list.
 */
export const reminderCandidates = Effect.gen(function* () {
  yield* requirePermission(manage)
  const rows = yield* orgQuery((db, organizationId) =>
    db.query.invoice.findMany({
      where: and(eq(invoice.organizationId, organizationId), isNull(invoice.voidedAt)),
      with: { reminders: { columns: { sentOn: true, feeOre: true } } },
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
        feeOre: problem ? 0 : reminderFee(settings, row.reminders),
      },
    ]
  })
})

export type ReminderCandidate = Effect.Success<typeof reminderCandidates>[number]

const problemMessages: Record<ReminderProblem, string> = {
  not_overdue: 'Avin har inte förfallit',
  nothing_owed: 'Avin har inget kvar att betala',
  too_soon: 'Det är för tidigt för nästa påminnelse',
  no_email: 'Mottagaren har ingen e-postadress',
}

/**
 * Sends a reminder for an overdue avi: what is still owed, plus the fee with its first reminder,
 * to pay with the same OCR by a new due date. The email goes first; then the reminder and its
 * fee posting are written in one batch.
 */
export const sendReminder = (invoiceId: string) =>
  Effect.gen(function* () {
    yield* requirePermission(manage)
    const inv = yield* getInvoice(invoiceId)
    const settings = yield* reminderSettings
    const on = yield* today
    const problem = reminderProblem(inv, inv.reminders, settings, on)
    if (problem) return yield* new Conflict({ message: problemMessages[problem] })
    if (!inv.seller.bankgiro || !inv.recipientEmail) {
      return yield* new Conflict({ message: 'Ange bankgironummer under Inställningar först' })
    }
    const feeOre = reminderFee(settings, inv.reminders)
    const owedOre = inv.owedOre + feeOre
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
        total: formatSek(owedOre),
        fee: feeOre > 0 ? formatSek(feeOre) : null,
        dueDate,
        bankgiro: inv.seller.bankgiro,
        ocr: inv.ocr,
        sellerDetails: sellerDetails(inv.seller, inv.vatOre > 0),
      },
    })

    const recipientEmail = inv.recipientEmail
    yield* orgQuery((db, organizationId) =>
      db.batch([
        db.insert(paymentReminder).values({
          organizationId,
          invoiceId: inv.id,
          sequence,
          sentOn: on,
          dueDate,
          owedOre,
          feeOre,
          recipientEmail,
        }),
        ...(feeOre > 0
          ? postingStatements(
              db,
              organizationId,
              {
                date: on,
                kind: 'reminder',
                description: `Påminnelseavgift, avi ${inv.number}`,
                invoiceId: inv.id,
              },
              reminderFeeEntries(inv.id, feeOre),
              { partyId: inv.partyId, agreementId: inv.agreementId },
            )
          : []),
      ]),
    )
    return { sequence, feeOre, dueDate }
  })

/** Sends reminders for several avier, a few at a time; one failure doesn't stop the others. */
export const sendReminders = (invoiceIds: readonly string[]) =>
  Effect.gen(function* () {
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
