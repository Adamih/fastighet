import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { isIsoDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { formatSek, parseSek } from '#/lib/money'
import { m } from '#/paraglide/messages'
import { changeBaseChargeFn } from './functions'
import type { AgreementKind } from './kinds'

interface ChangeValues {
  fromDate: string
  amount: string
}

/** A new rent or fee from a date. The server works out what already billed days need. */
export function ChangeChargeForm({
  interval,
  onSubmit,
}: {
  interval: 'monthly' | 'yearly'
  onSubmit: (value: { fromDate: string; amountOre: number }) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues: { fromDate: '', amount: '' } as ChangeValues,
    onSubmit: ({ value }) =>
      onSubmit({ fromDate: value.fromDate, amountOre: parseSek(value.amount) ?? 0 }),
  })
  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.AppField
        name="fromDate"
        validators={{
          onSubmit: ({ value }) => (isIsoDate(value) ? undefined : m.common_date_required()),
        }}
      >
        {(field) => <field.TextField label={m.charge_change_from()} type="date" />}
      </form.AppField>
      <form.AppField
        name="amount"
        validators={{
          onSubmit: ({ value }) =>
            parseSek(value) !== null ? undefined : m.charge_change_amount_required(),
        }}
      >
        {(field) => (
          <field.TextField
            label={
              interval === 'yearly' ? m.charge_change_amount_year() : m.charge_change_amount_month()
            }
            inputMode="decimal"
          />
        )}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton>{m.charge_change_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/**
 * "Ändra hyra" on a lease or "Ändra avgift" on a bostadsrätt. Returns the drawer controls and a
 * notice to show on the page after a change (mentioning any retroactive amount).
 */
export function useChangeBaseChargeDrawer(agreement: {
  id: string
  kind: AgreementKind
  rentOre: number
  rentInterval: 'monthly' | 'yearly'
}) {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const change = useFormMutation({
    mutationFn: changeBaseChargeFn,
    onSuccess: async ({ retroactiveOre }) => {
      setNotice(
        retroactiveOre === 0
          ? m.charge_change_done()
          : m.charge_change_retroactive({ amount: formatSek(retroactiveOre) }),
      )
      for (const queryKey of [
        ['leases'],
        ['ownerships'],
        ['invoices'],
        ['properties'],
        ['tenants'],
      ]) {
        await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
      }
    },
  })
  const fee = agreement.kind === 'tenant_ownership'
  const controls = useFormDrawer({
    title: fee ? m.charge_change_fee_title() : m.charge_change_rent_title(),
    description: m.charge_change_description({ amount: formatSek(agreement.rentOre) }),
    onClose: change.reset,
    form: ({ close }) => (
      <ChangeChargeForm
        interval={agreement.rentInterval}
        onSubmit={async (value) => {
          await change.mutateAsync({ data: { agreementId: agreement.id, ...value } })
          close()
        }}
      />
    ),
  })
  return { ...controls, notice, label: fee ? m.charge_change_fee() : m.charge_change_rent() }
}
