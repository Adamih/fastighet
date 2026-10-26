import { addDays, daysBetweenInclusive, maxDate, weekdayOnOrAfter } from '#/lib/dates'

// Pure rules for payment reminders (påminnelser). Shared by the server (sending) and the UI
// (which avier can be reminded, and what it will cost).

/**
 * The highest reminder fee the law allows (lagen om ersättning för inkassokostnader m.m.): 60 kr,
 * only if agreed in advance, and at most once per claim.
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
