import type { ReceivableEntry } from '#/features/ledger/postings'
import { addDays, daysBetweenInclusive, maxDate, weekdayOnOrAfter } from '#/lib/dates'

// Pure rules for payment reminders (påminnelser). Shared by the server (sending) and the UI
// (which avier can be reminded, and what it will cost).

/**
 * The highest reminder fee the law allows (lagen om ersättning för inkassokostnader m.m.): 60 kr,
 * only if agreed in advance, and at most once per claim. It is billed on the agreement's next
 * avi, like late interest, so the reminded avi only ever holds its own amount.
 */
export const MAX_REMINDER_FEE_ORE = 6_000

export const DEFAULT_REMINDER_INTERVAL_DAYS = 10
export const DEFAULT_REMINDER_DUE_DAYS = 10

export interface ReminderSettings {
  /** The fee charged with the first reminder of an avi, or null when no fee is agreed. */
  readonly reminderFeeOre: number | null
  /** Days after the due date, and after the previous reminder, before the next one. */
  readonly reminderIntervalDays: number
  /** Days the payer gets to pay a reminder. */
  readonly reminderDueDays: number
  /** Waive the fee when the avi itself is paid by the reminder's due date. */
  readonly waiveReminderFeeByDueDate: boolean
}

export type ReminderProblem = 'not_overdue' | 'nothing_owed' | 'too_soon' | 'no_email'

/**
 * Why an avi can't be reminded today, or null when it can: it must be overdue with something
 * still owed, and the interval must have passed since the due date and the last reminder.
 */
export function reminderProblem(
  invoice: {
    readonly status: string
    readonly owedOre: number
    readonly dueDate: string
    readonly recipientEmail: string | null
  },
  reminders: readonly { readonly sentOn: string }[],
  settings: Pick<ReminderSettings, 'reminderIntervalDays'>,
  today: string,
): ReminderProblem | null {
  if (invoice.status !== 'overdue') return 'not_overdue'
  if (invoice.owedOre <= 0) return 'nothing_owed'
  const since = reminders.reduce((latest, r) => maxDate(latest, r.sentOn), invoice.dueDate)
  if (daysBetweenInclusive(since, today) - 1 < settings.reminderIntervalDays) return 'too_soon'
  if (!invoice.recipientEmail) return 'no_email'
  return null
}

/** The first day the avi may be reminded (the interval after the due date or last reminder). */
export function nextReminderOn(
  dueDate: string,
  reminders: readonly { readonly sentOn: string }[],
  settings: Pick<ReminderSettings, 'reminderIntervalDays'>,
): string {
  const since = reminders.reduce((latest, r) => maxDate(latest, r.sentOn), dueDate)
  return addDays(since, settings.reminderIntervalDays)
}

/**
 * The fee for the next reminder: the agreed fee, capped at the legal maximum, and only if no
 * earlier reminder of the avi charged one.
 */
export function reminderFee(
  settings: Pick<ReminderSettings, 'reminderFeeOre'>,
  reminders: readonly { readonly feeOre: number }[],
): number {
  if (!settings.reminderFeeOre || settings.reminderFeeOre <= 0) return 0
  if (reminders.some((r) => r.feeOre > 0)) return 0
  return Math.min(settings.reminderFeeOre, MAX_REMINDER_FEE_ORE)
}

/** The reminder's new due date: the payment term from today, moved to a weekday. */
export const reminderDueDate = (
  today: string,
  settings: Pick<ReminderSettings, 'reminderDueDays'>,
) => weekdayOnOrAfter(addDays(today, settings.reminderDueDays))

/**
 * Why a reminder's fee was waived (its charge deleted before an avi billed it):
 * - `paid_before_reminder`: the money had arrived when the reminder went out (bank files are
 *   imported after the fact), so the reminder shouldn't have been sent.
 * - `paid_by_due_date`: the avi was paid by the reminder's due date, and the company waives the
 *   fee then (`waiveReminderFeeByDueDate`).
 * - `by_hand`: someone waived it ("Stryk avgiften", or removing the charge).
 */
export const feeWaivers = ['paid_before_reminder', 'paid_by_due_date', 'by_hand'] as const
export type FeeWaiver = (typeof feeWaivers)[number]

/**
 * Whether a reminder's fee is waived without anyone asking, from the avi's receivable entries
 * (the ones about to be written included). Settled money counts from its own date: a bank
 * payment's booking date, a payment by hand's paid date.
 * - What the avi owed was settled on or before the day the reminder was sent.
 * - If the company chose it: settled by the reminder's due date.
 */
export function automaticFeeWaiver(
  entries: readonly ReceivableEntry[],
  reminder: { readonly sentOn: string; readonly dueDate: string },
  settings: Pick<ReminderSettings, 'waiveReminderFeeByDueDate'>,
): Exclude<FeeWaiver, 'by_hand'> | null {
  // Fees posted to the avi itself (before fees became charges) aren't the avi's debt.
  const debt = entries.filter((e) => e.kind !== 'reminder')
  const owedOn = (date: string) =>
    debt.filter((e) => e.date <= date).reduce((s, e) => s + e.amountOre, 0)
  if (owedOn(reminder.sentOn) <= 0) return 'paid_before_reminder'
  if (settings.waiveReminderFeeByDueDate && owedOn(reminder.dueDate) <= 0) {
    return 'paid_by_due_date'
  }
  return null
}
