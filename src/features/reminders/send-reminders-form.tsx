import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { RowMeta, RowTitle } from '#/components/responsive'
import { SubmissionForm } from '#/components/submission-form'
import { useFormMutation } from '#/lib/form-mutation'
import { formatSek } from '#/lib/money'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { reminderCandidatesQuery, sendRemindersFn } from './functions'
import type { ReminderCandidate } from './program'

type SendResult = Awaited<ReturnType<typeof sendRemindersFn>>

/** Which overdue avier can be reminded today, what it costs, and sending them. */
export function SendRemindersForm({
  onSubmit,
  onDone,
}: {
  onSubmit: (invoiceIds: string[]) => Promise<SendResult>
  onDone: () => void
}) {
  const drawer = useFormDrawerContext()
  const [result, setResult] = useState<SendResult | null>(null)
  const candidates = useQuery({ ...reminderCandidatesQuery(), enabled: result === null })
  const rows = candidates.data ?? []
  const ready = rows.filter((r) => r.problem === null)
  const waiting = rows.filter((r) => r.problem !== null)
  const totalFee = ready.reduce((sum, r) => sum + r.feeOre, 0)
  const form = useAppForm({
    defaultValues: {},
    onSubmit: async (): Promise<void> => {
      if (result) onDone()
      else if (ready.length > 0) setResult(await onSubmit(ready.map((r) => r.invoiceId)))
    },
  })

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-5">
      {result ? (
        <section className="grid gap-2 text-sm">
          <p>{m.reminders_done({ count: result.sent })}</p>
          {result.failed > 0 && (
            <p className="text-destructive">{m.reminders_failed({ count: result.failed })}</p>
          )}
        </section>
      ) : candidates.error ? (
        <QueryError
          error={candidates.error}
          pending={candidates.isFetching}
          retry={() => candidates.refetch()}
        />
      ) : candidates.isPending ? (
        <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
      ) : (
        <>
          {ready.length === 0 ? (
            <p className="text-muted-foreground text-sm">{m.reminders_none()}</p>
          ) : (
            <CandidateList title={m.reminders_ready()} rows={ready} />
          )}
          {totalFee > 0 && (
            <p className="text-sm">{m.reminders_total_fee({ amount: formatSek(totalFee) })}</p>
          )}
          {waiting.length > 0 && (
            <CandidateList title={m.reminders_waiting()} rows={waiting} muted />
          )}
        </>
      )}
      <form.AppForm>
        <form.SubmitButton disabled={!result && ready.length === 0}>
          {result ? m.reminders_close() : m.reminders_submit({ count: ready.length })}
        </form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

function CandidateList({
  title,
  rows,
  muted = false,
}: {
  title: string
  rows: readonly ReminderCandidate[]
  muted?: boolean
}) {
  return (
    <section className="grid gap-2">
      <h3 className="font-medium text-sm">{title}</h3>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {rows.map((r) => (
          <li key={r.invoiceId} className={cn('grid gap-1 p-3', muted && 'text-muted-foreground')}>
            <RowTitle
              end={
                <span className="font-medium tabular-nums">{formatSek(r.owedOre + r.feeOre)}</span>
              }
            >
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: r.invoiceId }}
                className="underline-offset-4 hover:underline"
              >
                {r.recipientName}
              </Link>
            </RowTitle>
            <RowMeta>
              {[
                m.invoice_number({ number: r.number }),
                r.reminders > 0 && m.invoice_reminder_title({ sequence: r.reminders }),
                r.problem === 'too_soon' && m.reminders_next_on({ date: r.nextOn }),
                r.problem === 'no_email' && m.reminders_no_email(),
                r.feeOre > 0 && m.invoice_reminder_fee_next({ fee: formatSek(r.feeOre) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </RowMeta>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "Skicka påminnelser" on the invoice list's Förfallna filter. */
export function useSendRemindersDrawer() {
  const queryClient = useQueryClient()
  const send = useFormMutation({
    mutationFn: sendRemindersFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['invoices'] }, { throwOnError: true }),
  })
  return useFormDrawer({
    size: 'wide',
    title: m.reminders_title(),
    description: m.reminders_description(),
    onClose: send.reset,
    form: ({ close }) => (
      <SendRemindersForm
        onSubmit={(invoiceIds) => send.mutateAsync({ data: { invoiceIds } })}
        onDone={close}
      />
    ),
  })
}
