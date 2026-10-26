import { useQueryClient } from '@tanstack/react-query'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { isIsoDate, stockholmDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { parseSek } from '#/lib/money'
import { m } from '#/paraglide/messages'
import { addOneOffChargeFn } from './functions'

/** Kronor as typed, where a leading minus (or −) makes it a reduction. */
const parseSignedSek = (input: string) => {
  const trimmed = input.trim()
  const negative = /^[-−]/.test(trimmed)
  const ore = parseSek(negative ? trimmed.slice(1) : trimmed)
  return ore === null ? null : negative ? -ore : ore
}

interface OneOffValues {
  description: string
  amount: string
  fromDate: string
  vat: boolean
}

/** A one-off amount (engångsbelopp): what it is for, how much, and which avi it goes on. */
export function OneOffForm({
  vat,
  onSubmit,
}: {
  /** Whether the agreement's rent carries VAT, as the default. */
  vat: boolean
  onSubmit: (value: {
    description: string
    amountOre: number
    fromDate: string
    vat: boolean
  }) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues: {
      description: '',
      amount: '',
      fromDate: stockholmDate(Date.now()),
      vat,
    } as OneOffValues,
    onSubmit: ({ value }) =>
      onSubmit({
        description: value.description.trim(),
        amountOre: parseSignedSek(value.amount) ?? 0,
        fromDate: value.fromDate,
        vat: value.vat,
      }),
  })
  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.AppField
        name="description"
        validators={{
          onSubmit: ({ value }) => (value.trim() ? undefined : m.one_off_text_required()),
        }}
      >
        {(field) => (
          <field.TextField label={m.one_off_text()} placeholder={m.one_off_text_placeholder()} />
        )}
      </form.AppField>
      <form.AppField
        name="amount"
        validators={{
          onSubmit: ({ value }) => {
            const ore = parseSignedSek(value)
            return ore !== null && ore !== 0 ? undefined : m.one_off_amount_required()
          },
        }}
      >
        {(field) => (
          <field.TextField
            label={m.one_off_amount()}
            hint={m.one_off_amount_hint()}
            inputMode="decimal"
          />
        )}
      </form.AppField>
      <form.AppField
        name="fromDate"
        validators={{
          onSubmit: ({ value }) => (isIsoDate(value) ? undefined : m.common_date_required()),
        }}
      >
        {(field) => <field.TextField label={m.one_off_date()} type="date" />}
      </form.AppField>
      <form.AppField name="vat">
        {(field) => <field.SwitchField label={m.one_off_vat()} />}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton>{m.one_off_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Engångsbelopp" on a lease or bostadsrätt page. */
export function useAddOneOffDrawer(agreement: { id: string; vat: boolean }) {
  const queryClient = useQueryClient()
  const add = useFormMutation({
    mutationFn: addOneOffChargeFn,
    onSuccess: async () => {
      for (const queryKey of [['leases'], ['ownerships'], ['invoices']]) {
        await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
      }
    },
  })
  return useFormDrawer({
    title: m.one_off_title(),
    description: m.one_off_description(),
    onClose: add.reset,
    form: ({ close }) => (
      <OneOffForm
        vat={agreement.vat}
        onSubmit={async (value) => {
          await add.mutateAsync({ data: { agreementId: agreement.id, ...value } })
          close()
        }}
      />
    ),
  })
}
