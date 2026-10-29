import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import { reminderCandidates, sendReminder, sendReminders, waiveReminderFee } from './program'

const requestId = Schema.optional(Schema.String.check(Schema.isMaxLength(100)))

export const reminderCandidatesFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(reminderCandidates),
)

// Sending emails and records fees, so a retried request must not repeat it.
export const sendReminderFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ invoiceId: Schema.String, requestId })))
  .handler(({ data }) =>
    runApp(
      once('sendReminder', data, { invoice: ['manage'] }, sendReminder(data.invoiceId)),
      audit('reminder.send', data.invoiceId),
    ),
  )

export const sendRemindersFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        invoiceIds: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
        requestId,
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once('sendReminders', data, { invoice: ['manage'] }, sendReminders(data.invoiceIds)),
      audit('reminder.send_many', null),
    ),
  )

// Waiving twice finds no fee the second time, so a retry is refused rather than repeated.
export const waiveReminderFeeFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ invoiceId: Schema.String })))
  .handler(({ data }) =>
    runApp(waiveReminderFee(data.invoiceId), audit('reminder.waive_fee', data.invoiceId)),
  )

export const reminderCandidatesQuery = () =>
  queryOptions({
    queryKey: ['invoices', 'reminders'],
    queryFn: () => reminderCandidatesFn(),
  })
