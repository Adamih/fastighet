import { useStore } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Schema } from 'effect'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { RowMeta, RowTitle } from '#/components/responsive'
import { SubmissionForm } from '#/components/submission-form'
import { useCan } from '#/features/auth/use-can'
import { isAppError } from '#/lib/app-errors'
import { addMonths, stockholmDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { formatSek } from '#/lib/money'
import { rich } from '#/lib/rich'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { createInvoiceRunFn, invoiceRunPreviewQuery } from './functions'
import { isInvoiceMonth, periodLabel } from './rules'
import { CreateInvoiceRunInput } from './schemas'

const validator = Schema.toStandardSchemaV1(CreateInvoiceRunInput)
type RunResult = Awaited<ReturnType<typeof createInvoiceRunFn>>

/** Rent is invoiced in advance, so the natural default is next month. */
const nextMonth = () => addMonths(`${stockholmDate(Date.now()).slice(0, 7)}-01`, 1).slice(0, 7)

export function InvoiceRunForm({
  onSubmit,
  onDone,
  recovering = false,
}: {
  onSubmit: (value: CreateInvoiceRunInput) => Promise<RunResult>
  recovering?: boolean
  onDone: () => void
}) {
  const drawer = useFormDrawerContext()
  const canCreate = useCan()({ invoice: ['manage'], lease: ['read'] })
  const [defaultValues, setDefaultValues] = useState(() => ({ month: nextMonth(), send: true }))
  const [result, setResult] = useState<RunResult | null>(null)
  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: validator },
    onSubmit: async ({ value, formApi }): Promise<void> => {
      if (result) {
        onDone()
      } else if (canSubmit || recovering) {
        const summary = await onSubmit(value)
        setDefaultValues(value)
        formApi.reset(value)
        setResult(summary)
      }
    },
  })
  const { month, send } = useStore(form.store, (s) => s.values)
  const preview = useQuery({
    ...invoiceRunPreviewQuery(month),
    enabled: isInvoiceMonth(month) && canCreate && result === null,
  })
  const rows = preview.data?.rows ?? []
  const pending = rows.filter((r) => !r.alreadyInvoiced)
  const pendingTotal = pending.reduce((sum, r) => sum + r.totalOre, 0)
  const canSubmit =
    canCreate &&
    isInvoiceMonth(month) &&
    !preview.isFetching &&
    !preview.error &&
    preview.data?.canInvoice === true &&
    pending.length > 0

  if (!canCreate) return <p>{m.invoice_run_forbidden()}</p>

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-5">
      {result ? (
        <section className="grid gap-2 text-sm">
          <h2 className="font-medium text-lg">{m.invoice_run_done()}</h2>
          <ul className="grid gap-1">
            <li>{m.invoice_run_created({ count: result.created })}</li>
            {result.skipped > 0 && <li>{m.invoice_run_skipped({ count: result.skipped })}</li>}
            {send && <li>{m.invoice_run_sent({ count: result.sent })}</li>}
            {result.withoutEmail > 0 && (
              <li>{m.invoice_run_without_email({ count: result.withoutEmail })}</li>
            )}
            {result.failed > 0 && (
              <li className="text-destructive">{m.invoice_run_failed({ count: result.failed })}</li>
            )}
          </ul>
          {result.failedInvoiceIds.length > 0 && (
            <ul className="grid gap-1">
              {result.failedInvoiceIds.map((invoiceId, index) => (
                <li key={invoiceId}>
                  <Link className="underline" to="/invoices/$invoiceId" params={{ invoiceId }}>
                    {m.invoice_run_review_failed({ number: index + 1 })}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(submitting) => (
              <fieldset disabled={submitting} className="grid gap-4">
                <form.AppField name="month">
                  {(field) => <field.TextField label={m.invoice_run_month()} type="month" />}
                </form.AppField>
                <form.AppField name="send">
                  {(field) => (
                    <field.SwitchField disabled={submitting} label={m.invoice_run_send()} />
                  )}
                </form.AppField>
              </fieldset>
            )}
          </form.Subscribe>

          {!isInvoiceMonth(month) ? null : preview.isPending ? (
            <p className="text-muted-foreground text-sm">{m.invoice_run_calculating()}</p>
          ) : preview.error ? (
            <QueryError
              error={preview.error}
              pending={preview.isFetching}
              retry={() => preview.refetch()}
            />
          ) : preview.data && !preview.data.canInvoice ? (
            <p className="text-sm">
              {rich(
                (link) => m.invoice_run_needs_bankgiro({ link }),
                <Link to="/company-details" className="underline">
                  {m.nav_company_details()}
                </Link>,
              )}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{m.invoice_run_nothing({ month })}</p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {rows.map((r) => (
                <li
                  key={r.agreementId}
                  className={cn('grid gap-1 p-3', r.alreadyInvoiced && 'text-muted-foreground')}
                >
                  <RowTitle
                    end={<span className="font-medium tabular-nums">{formatSek(r.totalOre)}</span>}
                  >
                    {r.recipient.recipientName}
                  </RowTitle>
                  <RowMeta>
                    {m.invoice_run_row_meta({
                      number: r.agreementNumber,
                      period: periodLabel(r.period),
                      due: r.dueDate,
                    })}
                  </RowMeta>
                  {(r.alreadyInvoiced || r.vatOre > 0 || (!r.recipient.recipientEmail && send)) && (
                    <span className="text-muted-foreground text-xs">
                      {[
                        r.alreadyInvoiced && m.invoice_run_already(),
                        r.vatOre > 0 && m.common_incl_vat(),
                        !r.alreadyInvoiced &&
                          !r.recipient.recipientEmail &&
                          send &&
                          m.invoice_run_no_email(),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {pending.length > 0 && preview.data?.canInvoice && (
            <p className="text-sm">
              {rich(
                (amount) => m.invoice_run_total({ amount }),
                <span className="font-medium tabular-nums">{formatSek(pendingTotal)}</span>,
              )}
            </p>
          )}
        </>
      )}
      <form.AppForm>
        <form.SubmitButton disabled={!result && !canSubmit && !recovering}>
          {result
            ? m.invoice_run_view()
            : preview.data?.canInvoice && rows.length > 0 && !preview.error && !preview.isFetching
              ? pending.length > 0
                ? m.invoice_run_create({ count: pending.length })
                : m.invoice_run_all_done()
              : m.invoice_run_title()}
        </form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Skapa avier" on the invoice list, hosted by the app layout. */
export function useCreateInvoiceRunDrawer() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const create = useFormMutation({
    mutationFn: createInvoiceRunFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['invoices'] }, { throwOnError: true }),
  })
  return useFormDrawer({
    title: m.invoice_run_title(),
    description: m.invoice_run_intro(),
    onClose: create.reset,
    form: ({ close }) => (
      <InvoiceRunForm
        onSubmit={(value) => create.mutateAsync({ data: value })}
        recovering={isAppError(create.error) && create.error.code === 'refresh'}
        onDone={() => {
          close()
          void navigate({ to: '/invoices', search: {} })
        }}
      />
    ),
  })
}
