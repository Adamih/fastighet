import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { FactList } from '#/components/detail'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { SubmissionForm } from '#/components/submission-form'
import { useFormMutation } from '#/lib/form-mutation'
import { formatSek } from '#/lib/money'
import { rich } from '#/lib/rich'
import { m } from '#/paraglide/messages'
import { reissueInvoiceFn, reissuePreviewQuery } from './functions'
import { periodLabel } from './rules'

/** Shows the corrected avi before it is issued. It has nothing to fill in; it only confirms. */
export function ReissueForm({
  invoiceId,
  onSubmit,
}: {
  invoiceId: string
  onSubmit: () => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({ defaultValues: {}, onSubmit: () => onSubmit() })
  const preview = useQuery(reissuePreviewQuery(invoiceId))
  const data = preview.data
  const canSubmit = !!data && !data.problem && data.canInvoice && !preview.isFetching

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      {preview.isPending ? (
        <p className="text-muted-foreground text-sm">{m.invoice_run_calculating()}</p>
      ) : preview.error ? (
        <QueryError
          error={preview.error}
          pending={preview.isFetching}
          retry={() => preview.refetch()}
        />
      ) : data?.problem ? (
        <p className="text-sm">{data.problem}</p>
      ) : data && !data.canInvoice ? (
        <p className="text-sm">
          {rich(
            (link) => m.invoice_run_needs_bankgiro({ link }),
            <Link to="/settings" className="underline">
              {m.nav_settings()}
            </Link>,
          )}
        </p>
      ) : (
        data && (
          <div className="grid gap-3 rounded-lg border p-3.5">
            <p className="text-[13px]">{data.description}</p>
            <FactList
              facts={[
                [m.reissue_recipient(), data.recipient.recipientName],
                [
                  m.reissue_recipient_email(),
                  data.recipient.recipientEmail ?? m.invoice_run_no_email(),
                ],
                [m.common_period(), periodLabel(data.period)],
                [m.invoice_due_date(), data.dueDate],
                ...(data.vatOre > 0
                  ? ([[m.credit_preview_vat(), formatSek(data.vatOre)]] as const)
                  : []),
                [
                  m.common_amount(),
                  <strong key="total" className="tabular-nums">
                    {formatSek(data.totalOre)}
                  </strong>,
                ],
              ]}
            />
          </div>
        )
      )}
      <form.AppForm>
        <form.SubmitButton disabled={!canSubmit}>{m.reissue_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Ny avi för perioden" on a voided or fully credited avi. Opens the new avi when it exists. */
export function useReissueInvoiceDrawer(invoice: { id: string; number: number }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const reissue = useFormMutation({
    mutationFn: reissueInvoiceFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['invoices'] }, { throwOnError: true }),
  })
  return useFormDrawer({
    title: m.reissue_title(),
    description: m.reissue_description({ number: invoice.number }),
    onClose: reissue.reset,
    form: ({ close }) => (
      <ReissueForm
        invoiceId={invoice.id}
        onSubmit={async () => {
          const created = await reissue.mutateAsync({ data: { invoiceId: invoice.id } })
          close()
          await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: created.id } })
        }}
      />
    ),
  })
}
