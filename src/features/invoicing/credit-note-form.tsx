import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { useFormMutation } from '#/lib/form-mutation'
import { formatSek, parseSek } from '#/lib/money'
import { m } from '#/paraglide/messages'
import {
  type CreditableInvoice,
  type CreditProblem,
  type CreditRequest,
  draftCreditNote,
  remainingOre,
  vatRateOf,
} from './credit'
import { createCreditNoteFn } from './functions'

type Kind = CreditRequest['kind']

export interface CreditValues {
  kind: Kind
  /** Excluding VAT; only for `amount`. */
  netOre: number | undefined
  reason: string
}

type InvoiceToCredit = CreditableInvoice & { id: string; paidOn: string | null }

const problemMessages: Record<CreditProblem, () => string> = {
  void: m.credit_problem_void,
  nothing_left: m.credit_problem_nothing_left,
  not_positive: m.credit_problem_not_positive,
  too_much: m.credit_problem_too_much,
}

const requestFor = (kind: Kind, amount: string): CreditRequest =>
  kind === 'rest' ? { kind: 'rest' } : { kind: 'amount', netOre: parseSek(amount) ?? 0 }

/** Credits all or part of an invoice. Shows what will be credited and what is left. */
export function CreditNoteForm({
  invoice,
  onSubmit,
}: {
  invoice: InvoiceToCredit
  onSubmit: (value: CreditValues) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const hasVat = vatRateOf(invoice) > 0
  const form = useAppForm({
    defaultValues: { kind: 'rest' as Kind, amount: '', reason: '' },
    onSubmit: ({ value }) =>
      onSubmit({
        kind: value.kind,
        netOre: value.kind === 'amount' ? (parseSek(value.amount) ?? undefined) : undefined,
        reason: value.reason.trim(),
      }),
  })

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.AppField name="kind">
        {(field) => (
          <field.SegmentedField
            label={m.credit_form_kind()}
            options={[
              {
                value: 'rest',
                label:
                  invoice.creditedOre > 0 ? m.credit_form_kind_rest() : m.credit_form_kind_all(),
              },
              { value: 'amount', label: m.credit_form_kind_amount() },
            ]}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(s) => s.values.kind}>
        {(kind) =>
          kind === 'amount' && (
            <form.AppField
              name="amount"
              validators={{
                onSubmit: ({ value }) => {
                  const result = draftCreditNote(invoice, requestFor('amount', value))
                  return result.ok ? undefined : problemMessages[result.problem]()
                },
              }}
            >
              {(field) => (
                <field.TextField
                  label={hasVat ? m.credit_form_amount_excl_vat() : m.credit_form_amount()}
                  placeholder="2 000"
                  inputMode="decimal"
                />
              )}
            </form.AppField>
          )
        }
      </form.Subscribe>
      <form.AppField
        name="reason"
        validators={{
          onSubmit: ({ value }) => (value.trim() ? undefined : m.credit_form_reason_required()),
        }}
      >
        {(field) => (
          <field.TextField
            label={m.credit_form_reason()}
            placeholder={m.credit_form_reason_placeholder()}
            hint={m.credit_form_reason_hint()}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(s) => [s.values.kind, s.values.amount] as const}>
        {([kind, amount]) => <CreditPreview invoice={invoice} request={requestFor(kind, amount)} />}
      </form.Subscribe>
      <form.AppForm>
        <form.SubmitButton>{m.credit_form_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Krediteras: …", then what the tenant still owes, or what is paid back if already paid. */
function CreditPreview({ invoice, request }: { invoice: InvoiceToCredit; request: CreditRequest }) {
  const result = draftCreditNote(invoice, request)
  if (!result.ok) return null
  const { draft } = result
  const left = remainingOre(invoice) - draft.totalOre
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 rounded-lg bg-muted/50 p-3.5 text-[13px]">
      <dt className="text-muted-foreground">{m.credit_preview_credited()}</dt>
      <dd className="text-right font-semibold tabular-nums">{formatSek(draft.totalOre)}</dd>
      {draft.vatOre > 0 && (
        <>
          <dt className="text-muted-foreground">{m.credit_preview_vat()}</dt>
          <dd className="text-right tabular-nums">{formatSek(draft.vatOre)}</dd>
        </>
      )}
      {invoice.paidOn ? (
        <>
          <dt className="text-muted-foreground">{m.credit_preview_refund()}</dt>
          <dd className="text-right tabular-nums">{formatSek(draft.totalOre)}</dd>
        </>
      ) : (
        <>
          <dt className="text-muted-foreground">{m.credit_preview_left()}</dt>
          <dd className="text-right tabular-nums">{formatSek(left)}</dd>
        </>
      )}
    </dl>
  )
}

/** "Kreditera" on the invoice page. Opens the new credit note when it has been created. */
export function useCreditInvoiceDrawer(invoice: InvoiceToCredit) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const create = useFormMutation({
    mutationFn: createCreditNoteFn,
    onSuccess: async () => {
      // Invoice totals show on the invoice, payment, tenant and lease pages.
      for (const queryKey of [['invoices'], ['payments'], ['tenants'], ['leases']]) {
        await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
      }
    },
  })
  return useFormDrawer({
    title: m.credit_title({ number: invoice.number }),
    description: m.credit_description(),
    onClose: create.reset,
    form: ({ close }) => (
      <CreditNoteForm
        invoice={invoice}
        onSubmit={async (value) => {
          const created = await create.mutateAsync({ data: { invoiceId: invoice.id, ...value } })
          close()
          await navigate({
            to: '/credit-notes/$creditNoteId',
            params: { creditNoteId: created.id },
          })
        }}
      />
    ),
  })
}
