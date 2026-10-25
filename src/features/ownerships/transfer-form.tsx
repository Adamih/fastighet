import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { SubmissionForm } from '#/components/submission-form'
import { useCan } from '#/features/auth/use-can'
import { invoicesQuery } from '#/features/invoicing/functions'
import { tenantsQuery } from '#/features/tenants/functions'
import { isIsoDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'
import { transferOwnershipFn } from './functions'
import { OwnersField, type OwnerValue, ownersValidator, toOwners } from './owners-field'
import { receiverOf, receiverOptions } from './ownership-form'
import type { OwnershipView } from './program'
import { invoicedPastTransfer, sellersLastDay, transferProblem } from './rules'

/** A sale: the buyers and their first day. Shows the sellers' last day and avier to credit. */
export function TransferForm({
  ownership,
  tenants,
  invoices,
  onSubmit,
}: {
  ownership: OwnershipView
  tenants: readonly { id: string; name: string }[]
  invoices: readonly {
    number: number
    periodEnd: string
    status: Parameters<typeof invoicedPastTransfer>[0][number]['status']
  }[]
  onSubmit: (value: {
    transferDate: string
    owners: { partyId: string; sharePercent: number }[]
    invoiceRecipientId: string | null
  }) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues: { transferDate: '', owners: [] as OwnerValue[], invoiceRecipientId: '' },
    onSubmit: ({ value }) =>
      onSubmit({
        transferDate: value.transferDate,
        owners: toOwners(value.owners),
        invoiceRecipientId: receiverOf(value.owners, value.invoiceRecipientId),
      }),
  })

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-5">
      <form.AppField
        name="transferDate"
        validators={{
          onSubmit: ({ value }) => {
            if (!isIsoDate(value)) return m.common_date_required()
            return transferProblem(ownership, value) === 'too_early'
              ? m.ownership_transfer_too_early({ date: ownership.startDate })
              : undefined
          },
        }}
      >
        {(field) => <field.TextField label={m.ownership_transfer_date()} type="date" />}
      </form.AppField>
      <form.Subscribe selector={(s) => s.values.transferDate}>
        {(transferDate) => {
          if (!isIsoDate(transferDate) || transferProblem(ownership, transferDate)) return null
          const toCredit = invoicedPastTransfer(invoices, transferDate)
          return (
            <div className="grid gap-2 rounded-lg bg-muted/50 p-3.5 text-[13px]">
              <p>{m.ownership_transfer_sellers_last({ date: sellersLastDay(transferDate) })}</p>
              {toCredit.length > 0 && (
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  {m.ownership_transfer_invoiced({
                    invoices: toCredit
                      .map((i) => m.invoice_number({ number: i.number }))
                      .join(', '),
                    date: transferDate,
                  })}
                </p>
              )}
            </div>
          )
        }}
      </form.Subscribe>

      <form.AppField name="owners" validators={ownersValidator}>
        {() => (
          <OwnersField
            label={m.ownership_buyers()}
            tenants={tenants}
            onRemove={(id) => {
              if (form.getFieldValue('invoiceRecipientId') === id) {
                form.setFieldValue('invoiceRecipientId', '')
              }
            }}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(s) => s.values.owners}>
        {(owners) =>
          owners.length > 1 && (
            <form.AppField name="invoiceRecipientId">
              {(field) => (
                <field.SelectField
                  label={m.ownership_invoice_recipient()}
                  placeholder={receiverOptions(owners, tenants)[0].label}
                  options={receiverOptions(owners, tenants)}
                />
              )}
            </form.AppField>
          )
        }
      </form.Subscribe>

      <form.AppForm>
        <form.SubmitButton>{m.ownership_transfer_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Registrera överlåtelse" on the bostadsrätt page. Opens the buyers' bostadsrätt afterwards. */
export function useTransferOwnershipDrawer(ownership: OwnershipView) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const can = useCan()
  const enabled = can({ lease: ['manage'], tenant: ['read'] })
  const tenants = useQuery({ ...tenantsQuery(), enabled })
  // Avier to the sellers, to point out what needs crediting; only for those who may read them.
  const invoices = useQuery({
    ...invoicesQuery({ filter: 'all', agreementId: ownership.id }),
    enabled: enabled && can({ invoice: ['read'] }),
  })
  const transfer = useFormMutation({
    mutationFn: transferOwnershipFn,
    onSuccess: async () => {
      for (const queryKey of [['ownerships'], ['tenants'], ['properties'], ['units']]) {
        await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
      }
    },
  })
  return useFormDrawer({
    size: 'wide',
    title: m.ownership_transfer_title({ number: ownership.number }),
    description: m.ownership_transfer_intro(),
    onClose: transfer.reset,
    form: ({ close }) => {
      if (tenants.error) {
        return (
          <QueryError
            error={tenants.error}
            pending={tenants.isFetching}
            retry={() => tenants.refetch()}
          />
        )
      }
      if (!tenants.data)
        return <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
      return (
        <TransferForm
          ownership={ownership}
          tenants={tenants.data}
          invoices={invoices.data ?? []}
          onSubmit={async (value) => {
            const created = await transfer.mutateAsync({
              data: { ownershipId: ownership.id, ...value },
            })
            close()
            await navigate({ to: '/ownerships/$ownershipId', params: { ownershipId: created.id } })
          }}
        />
      )
    },
  })
}
