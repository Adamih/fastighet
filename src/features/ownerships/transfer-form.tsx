import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { SubmissionForm } from '#/components/submission-form'
import { Switch } from '#/components/ui/switch'
import { useCan } from '#/features/auth/use-can'
import { invoicesQuery } from '#/features/invoicing/functions'
import type { PledgeView } from '#/features/pledges/program'
import type { FeeTerms } from '#/features/settings/program'
import { tenantsQuery } from '#/features/tenants/functions'
import { isIsoDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'
import { feeDescription } from './fee-text'
import { feeTermsQuery, transferOwnershipFn } from './functions'
import { OwnersField, type OwnerValue, ownersValidator, toOwners } from './owners-field'
import { receiverOf, receiverOptions } from './ownership-form'
import type { OwnershipView } from './program'
import { invoicedPastTransfer, sellersLastDay, transferProblem } from './rules'

type Seller = OwnershipView & { pledges: readonly PledgeView[] }

/**
 * A sale: the buyers and their first day. Shows the sellers' last day, avier to credit and the
 * sellers' pledges, which can be released in the same step.
 */
export function TransferForm({
  ownership,
  tenants,
  invoices,
  feeTerms,
  onSubmit,
}: {
  ownership: Seller
  tenants: readonly { id: string; name: string }[]
  invoices: readonly {
    number: number
    periodEnd: string
    status: Parameters<typeof invoicedPastTransfer>[0][number]['status']
  }[]
  feeTerms: FeeTerms | undefined
  onSubmit: (value: {
    transferDate: string
    owners: { partyId: string; sharePercent: number }[]
    invoiceRecipientId: string | null
    releasePledgeIds: string[]
    chargeTransferFee: boolean
  }) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const pledges = ownership.pledges.filter((p) => p.active)
  const form = useAppForm({
    defaultValues: {
      transferDate: '',
      owners: [] as OwnerValue[],
      invoiceRecipientId: '',
      // Nothing is released unless the board ticks it: lenders ask for releases themselves.
      releasePledgeIds: [] as string[],
      chargeTransferFee: true,
    },
    onSubmit: ({ value }) =>
      onSubmit({
        transferDate: value.transferDate,
        owners: toOwners(value.owners),
        invoiceRecipientId: receiverOf(value.owners, value.invoiceRecipientId),
        releasePledgeIds: value.releasePledgeIds,
        chargeTransferFee: value.chargeTransferFee && feeTerms?.transferFeeBasisPoints != null,
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

      {pledges.length > 0 && (
        <fieldset className="grid gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <legend className="sr-only">{m.pledge_transfer_title()}</legend>
          <p className="font-semibold">{m.pledge_transfer_title()}</p>
          <p>{m.pledge_transfer_warning()}</p>
          <form.Field name="releasePledgeIds">
            {(field) => (
              <ul className="grid gap-2">
                {pledges.map((p) => {
                  const id = `release-${p.id}`
                  const checked = field.state.value.includes(p.id)
                  return (
                    <li key={p.id} className="flex items-start gap-2.5">
                      <Switch
                        id={id}
                        className="mt-0.5 shrink-0"
                        checked={checked}
                        onCheckedChange={(next) =>
                          field.handleChange(
                            next === true
                              ? [...field.state.value, p.id]
                              : field.state.value.filter((x) => x !== p.id),
                          )
                        }
                      />
                      <label htmlFor={id} className="grid gap-0.5">
                        <span className="font-medium">
                          {p.priority}. {p.creditorName}
                        </span>
                        <span>
                          {[
                            m.pledge_notified({ date: p.notifiedOn }),
                            p.reference && m.pledge_ref({ reference: p.reference }),
                            m.pledge_transfer_release(),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </form.Field>
        </fieldset>
      )}

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

      {feeTerms && feeTerms.transferFeeBasisPoints !== null && (
        <form.Subscribe selector={(s) => s.values.transferDate}>
          {(transferDate) => (
            <form.AppField name="chargeTransferFee">
              {(field) => (
                <field.SwitchField
                  label={m.ownership_transfer_charge_fee()}
                  description={feeDescription(feeTerms, 'transfer_fee', transferDate)}
                />
              )}
            </form.AppField>
          )}
        </form.Subscribe>
      )}

      <form.AppForm>
        <form.SubmitButton>{m.ownership_transfer_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Registrera överlåtelse" on the bostadsrätt page. Opens the buyers' bostadsrätt afterwards. */
export function useTransferOwnershipDrawer(ownership: Seller) {
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
  const feeTerms = useQuery({ ...feeTermsQuery(), enabled })
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
          feeTerms={feeTerms.data}
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
