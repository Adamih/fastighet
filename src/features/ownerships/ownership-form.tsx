import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { DeleteButton } from '#/components/delete-button'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { SubmissionForm } from '#/components/submission-form'
import { UnitsField } from '#/features/agreements/units-field'
import { useCan } from '#/features/auth/use-can'
import { type InvoiceInterval, invoiceIntervalLabels } from '#/features/leases/options'
import { unitsQuery } from '#/features/properties/functions'
import type { UnitKind } from '#/features/properties/unit-kinds'
import { tenantsQuery } from '#/features/tenants/functions'
import { isIsoDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { oreToInput, parseSek } from '#/lib/money'
import { rich } from '#/lib/rich'
import { m } from '#/paraglide/messages'
import {
  createOwnershipFn,
  deleteOwnershipFn,
  ownershipQuery,
  updateOwnershipFn,
} from './functions'
import { OwnersField, type OwnerValue, ownersValidator, toOwners } from './owners-field'
import type { OwnershipView } from './program'
import type { CreateOwnershipInput } from './schemas'

export interface OwnershipFormValues {
  owners: OwnerValue[]
  /** Blank means the first owner receives the avier. */
  invoiceRecipientId: string
  unitIds: string[]
  startDate: string
  fee: string
  invoiceInterval: InvoiceInterval
  shareRatio: string
  deposit: string
  grantedOn: string
}

const emptyOwnership: OwnershipFormValues = {
  owners: [],
  invoiceRecipientId: '',
  unitIds: [],
  startDate: '',
  fee: '',
  invoiceInterval: 'monthly',
  shareRatio: '',
  deposit: '',
  grantedOn: '',
}

const parseRatio = (value: string) => {
  const n = Number(value.trim().replace(',', '.'))
  return value.trim() && Number.isFinite(n) && n > 0 ? n : null
}

/** The receiver, if it is one of the owners other than the first (who receives by default). */
export const receiverOf = (owners: readonly OwnerValue[], receiverId: string) =>
  receiverId && owners.some((o, i) => i > 0 && o.tenantId === receiverId) ? receiverId : null

const toInput = (value: OwnershipFormValues): CreateOwnershipInput => ({
  owners: toOwners(value.owners),
  invoiceRecipientId: receiverOf(value.owners, value.invoiceRecipientId),
  unitIds: value.unitIds,
  startDate: value.startDate,
  feeOre: parseSek(value.fee) ?? 0,
  invoiceInterval: value.invoiceInterval,
  shareRatio: parseRatio(value.shareRatio),
  depositOre: value.deposit.trim() ? (parseSek(value.deposit) ?? null) : null,
  grantedOn: value.grantedOn.trim() ? value.grantedOn : null,
})

const date = {
  onSubmit: ({ value }: { value: string }) =>
    isIsoDate(value) ? undefined : m.common_date_required(),
}
const optionalDate = {
  onSubmit: ({ value }: { value: string }) =>
    !value.trim() || isIsoDate(value) ? undefined : m.common_date_required(),
}

/** The choices for who receives the avier: the owners, by name. */
export const receiverOptions = (
  owners: readonly OwnerValue[],
  tenants: readonly { id: string; name: string }[],
) =>
  owners.map((o) => ({
    value: o.tenantId,
    label: tenants.find((t) => t.id === o.tenantId)?.name ?? '',
  }))

/** A bostadsrätt's owners, units, fee and details. Shared by the add and edit drawers. */
export function OwnershipForm({
  tenants,
  units,
  defaultValues,
  submitLabel,
  onSubmit,
}: {
  tenants: readonly { id: string; name: string }[]
  units: readonly { id: string; label: string; kind: UnitKind; designation: string }[]
  defaultValues: OwnershipFormValues
  submitLabel: string
  onSubmit: (value: CreateOwnershipInput) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues,
    onSubmit: ({ value }) => onSubmit(toInput(value)),
  })

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-6">
      <form.AppField name="owners" validators={ownersValidator}>
        {() => (
          <OwnersField
            label={m.ownership_owners()}
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
                <div className="grid gap-1.5">
                  <field.SelectField
                    label={m.ownership_invoice_recipient()}
                    // Blank means the first owner, whose name stands in until another is chosen.
                    placeholder={receiverOptions(owners, tenants)[0].label}
                    options={receiverOptions(owners, tenants)}
                  />
                  <p className="text-muted-foreground text-sm">
                    {m.ownership_invoice_recipient_hint()}
                  </p>
                </div>
              )}
            </form.AppField>
          )
        }
      </form.Subscribe>

      <form.AppField
        name="unitIds"
        validators={{
          onSubmit: ({ value }) => (value.length > 0 ? undefined : m.lease_form_units_required()),
        }}
      >
        {() => (
          <UnitsField label={m.ownership_units()} hint={m.ownership_units_hint()} units={units} />
        )}
      </form.AppField>

      <div className="grid gap-4 @md/form-drawer:grid-cols-2">
        <form.AppField name="startDate" validators={date}>
          {(field) => <field.TextField label={m.ownership_start()} type="date" />}
        </form.AppField>
        <form.AppField
          name="fee"
          validators={{
            onSubmit: ({ value }) =>
              parseSek(value) !== null ? undefined : m.ownership_fee_required(),
          }}
        >
          {(field) => (
            <field.TextField label={m.ownership_fee()} placeholder="4 250" inputMode="decimal" />
          )}
        </form.AppField>
      </div>
      <form.AppField name="invoiceInterval">
        {(field) => (
          <field.SegmentedField
            label={m.lease_form_invoice_interval()}
            showLabel
            options={(['monthly', 'quarterly'] as const).map((value) => ({
              value,
              label: invoiceIntervalLabels[value],
            }))}
          />
        )}
      </form.AppField>

      <div className="grid gap-4 @md/form-drawer:grid-cols-3">
        <form.AppField
          name="shareRatio"
          validators={{
            onSubmit: ({ value }) =>
              !value.trim() || parseRatio(value) !== null
                ? undefined
                : m.ownership_share_ratio_invalid(),
          }}
        >
          {(field) => (
            <field.TextField
              label={<Optional>{m.ownership_share_ratio()}</Optional>}
              placeholder="2,145"
              inputMode="decimal"
            />
          )}
        </form.AppField>
        <form.AppField name="deposit">
          {(field) => (
            <field.TextField
              label={<Optional>{m.ownership_deposit()}</Optional>}
              placeholder="350 000"
              inputMode="decimal"
            />
          )}
        </form.AppField>
        <form.AppField name="grantedOn" validators={optionalDate}>
          {(field) => (
            <field.TextField label={<Optional>{m.ownership_granted_on()}</Optional>} type="date" />
          )}
        </form.AppField>
      </div>

      <form.AppForm>
        <form.SubmitButton>{submitLabel}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** Loads the owner and unit choices when a drawer opens. */
function useChoices() {
  const enabled = useCan()({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const tenants = useQuery({ ...tenantsQuery(), enabled })
  const units = useQuery({ ...unitsQuery(), enabled })
  const error = tenants.error ?? units.error
  const loading =
    error || !tenants.data || !units.data ? (
      error ? (
        <QueryError
          error={error}
          pending={tenants.isFetching || units.isFetching}
          retry={() => Promise.all([tenants.refetch(), units.refetch()])}
        />
      ) : (
        <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
      )
    ) : null
  return { tenants: tenants.data, units: units.data, loading }
}

const useRefresh = () => {
  const queryClient = useQueryClient()
  return async () => {
    for (const queryKey of [['ownerships'], ['tenants'], ['properties'], ['units']]) {
      await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
    }
  }
}

/** "Lägg till bostadsrätt" on the bostadsrätter page. Opens the new one when it is created. */
export function useAddOwnershipDrawer() {
  const navigate = useNavigate()
  const refresh = useRefresh()
  const create = useFormMutation({ mutationFn: createOwnershipFn, onSuccess: refresh })
  const choices = useChoices()
  return useFormDrawer({
    size: 'wide',
    title: m.ownership_add_title(),
    description: m.ownership_add_intro(),
    onClose: create.reset,
    form: ({ close }) => {
      if (choices.loading) return choices.loading
      const { tenants = [], units = [] } = choices
      if (tenants.length === 0 || units.length === 0) {
        return (
          <p className="text-muted-foreground text-sm">
            {rich(
              (link) => m.lease_new_missing({ link }),
              tenants.length === 0 ? (
                <Link to="/tenants" className="underline">
                  {m.lease_new_add_tenant()}
                </Link>
              ) : (
                <Link to="/" className="underline">
                  {m.lease_new_add_unit()}
                </Link>
              ),
            )}
          </p>
        )
      }
      return (
        <OwnershipForm
          tenants={tenants}
          units={units}
          defaultValues={emptyOwnership}
          submitLabel={m.ownership_create()}
          onSubmit={async (value) => {
            const created = await create.mutateAsync({ data: value })
            close()
            await navigate({ to: '/ownerships/$ownershipId', params: { ownershipId: created.id } })
          }}
        />
      )
    },
  })
}

/** "Ändra" on the bostadsrätt page, with deleting at the bottom. */
export function useEditOwnershipDrawer(ownership: OwnershipView) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const refresh = useRefresh()
  const update = useFormMutation({
    mutationFn: updateOwnershipFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(ownershipQuery(ownership.id).queryKey, updated)
      await refresh()
    },
  })
  const remove = useFormMutation({
    mutationFn: deleteOwnershipFn,
    onSuccess: async ({ previousId }) => {
      // Deleting a bostadsrätt from a transfer reopens the sellers'; show that one.
      await (previousId
        ? navigate({ to: '/ownerships/$ownershipId', params: { ownershipId: previousId } })
        : navigate({ to: '/ownerships' }))
      queryClient.removeQueries({ queryKey: ownershipQuery(ownership.id).queryKey })
      await refresh()
    },
  })
  const choices = useChoices()
  const receiver = ownership.owners.find((o) => o.receivesInvoices)
  return useFormDrawer({
    size: 'wide',
    title: m.ownership_edit_title({ number: ownership.number }),
    description: m.ownership_edit_intro({ owners: ownership.ownerNames }),
    onClose: () => {
      update.reset()
      remove.reset()
    },
    form: ({ close }) => (
      <div className="grid gap-6">
        {choices.loading ?? (
          <OwnershipForm
            tenants={choices.tenants ?? []}
            units={choices.units ?? []}
            defaultValues={{
              owners: ownership.owners.map((o) => ({
                tenantId: o.id,
                share: String(o.sharePercent),
              })),
              invoiceRecipientId:
                receiver && receiver.id !== ownership.owners[0]?.id ? receiver.id : '',
              unitIds: ownership.units.map((u) => u.id),
              startDate: ownership.startDate,
              fee: oreToInput(ownership.rentOre),
              invoiceInterval: ownership.invoiceInterval,
              shareRatio:
                ownership.shareRatio === null ? '' : String(ownership.shareRatio).replace('.', ','),
              deposit: ownership.depositOre === null ? '' : oreToInput(ownership.depositOre),
              grantedOn: ownership.grantedOn ?? '',
            }}
            submitLabel={m.common_save_changes()}
            onSubmit={async (value) => {
              await update.mutateAsync({ data: { ownershipId: ownership.id, ...value } })
              close()
            }}
          />
        )}
        <section className="grid gap-2 border-t pt-5 text-sm">
          <h2 className="font-medium">{m.common_delete()}</h2>
          <p className="text-muted-foreground">{m.ownership_delete_rule()}</p>
          <DeleteButton
            label={m.ownership_delete()}
            question={m.ownership_delete_confirm({ number: ownership.number })}
            pending={remove.isPending}
            onConfirm={() => remove.mutate({ data: { ownershipId: ownership.id } })}
          />
          {remove.error && <p className="text-destructive">{remove.error.message}</p>}
        </section>
      </div>
    ),
  })
}
