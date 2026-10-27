import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { useCan } from '#/features/auth/use-can'
import { feeDescription } from '#/features/ownerships/fee-text'
import { feeTermsQuery } from '#/features/ownerships/functions'
import type { FeeTerms } from '#/features/settings/program'
import { isIsoDate, stockholmDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'
import { registerPledgeFn, releasePledgeFn } from './functions'
import { registerProblem, releaseProblem } from './rules'

const refresh = (queryClient: ReturnType<typeof useQueryClient>) =>
  queryClient.invalidateQueries({ queryKey: ['ownerships'] }, { throwOnError: true })

/**
 * A lender's notice: who, their reference and the day it reached the förening; the
 * pantsättningsavgift if the förening charges one, and where to email the confirmation.
 */
function RegisterPledgeForm({
  ownership,
  feeTerms,
  onSubmit,
}: {
  ownership: { endDate: string | null }
  feeTerms: FeeTerms | undefined
  onSubmit: (value: {
    creditorName: string
    creditorOrganizationNumber: string
    reference: string
    notifiedOn: string
    note: string
    chargeFee: boolean
    confirmationEmail: string
  }) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const today = stockholmDate(Date.now())
  const form = useAppForm({
    defaultValues: {
      creditorName: '',
      creditorOrganizationNumber: '',
      reference: '',
      notifiedOn: today,
      note: '',
      // The board skips the fee only where the bylaws say otherwise.
      chargeFee: true,
      confirmationEmail: '',
    },
    onSubmit: ({ value }) =>
      onSubmit({
        ...value,
        chargeFee: value.chargeFee && feeTerms?.pledgeFeeBasisPoints != null,
      }),
  })
  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.AppField
        name="creditorName"
        validators={{
          onSubmit: ({ value }) => (value.trim() ? undefined : m.pledge_errors_creditor()),
        }}
      >
        {(field) => (
          <field.TextField
            label={m.pledge_creditor()}
            placeholder={m.pledge_creditor_placeholder()}
            autoComplete="organization"
          />
        )}
      </form.AppField>
      <form.AppField name="creditorOrganizationNumber">
        {(field) => (
          <field.TextField
            label={<Optional>{m.pledge_creditor_org_number()}</Optional>}
            placeholder="556677-8899"
            inputMode="numeric"
          />
        )}
      </form.AppField>
      <form.AppField name="reference">
        {(field) => (
          <field.TextField
            label={<Optional>{m.pledge_reference()}</Optional>}
            hint={m.pledge_reference_hint()}
          />
        )}
      </form.AppField>
      <form.AppField
        name="notifiedOn"
        validators={{
          onSubmit: ({ value }) => {
            if (!isIsoDate(value)) return m.common_date_required()
            const problem = registerProblem(ownership, value, today)
            if (problem === 'future') return m.pledge_errors_future()
            if (problem === 'ended') return m.pledge_errors_after_sale()
            return undefined
          },
        }}
      >
        {(field) => <field.TextField label={m.pledge_notified_on()} type="date" />}
      </form.AppField>
      <form.AppField name="note">
        {(field) => <field.TextField label={<Optional>{m.pledge_note()}</Optional>} />}
      </form.AppField>
      <form.AppField name="confirmationEmail">
        {(field) => (
          <field.TextField
            label={<Optional>{m.pledge_confirmation_email()}</Optional>}
            type="email"
            hint={m.pledge_confirmation_email_hint()}
          />
        )}
      </form.AppField>
      {feeTerms && feeTerms.pledgeFeeBasisPoints !== null && (
        <form.Subscribe selector={(s) => s.values.notifiedOn}>
          {(notifiedOn) => (
            <form.AppField name="chargeFee">
              {(field) => (
                <field.SwitchField
                  label={m.pledge_charge_fee()}
                  description={feeDescription(feeTerms, 'pledge_fee', notifiedOn)}
                />
              )}
            </form.AppField>
          )}
        </form.Subscribe>
      )}
      <form.AppForm>
        <form.SubmitButton>{m.pledge_register_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Registrera pantsättning" on the bostadsrätt page. */
export function useRegisterPledgeDrawer(ownership: { id: string; endDate: string | null }) {
  const queryClient = useQueryClient()
  const feeTerms = useQuery({ ...feeTermsQuery(), enabled: useCan()({ lease: ['manage'] }) })
  const register = useFormMutation({
    mutationFn: registerPledgeFn,
    onSuccess: () => refresh(queryClient),
  })
  return useFormDrawer({
    title: m.pledge_register(),
    description: m.pledge_register_description(),
    onClose: register.reset,
    form: ({ close }) => (
      <RegisterPledgeForm
        ownership={ownership}
        feeTerms={feeTerms.data}
        onSubmit={async (value) => {
          await register.mutateAsync({ data: { ownershipId: ownership.id, ...value } })
          close()
        }}
      />
    ),
  })
}

function ReleasePledgeForm({
  pledge,
  onSubmit,
}: {
  pledge: { notifiedOn: string; releasedOn: string | null }
  onSubmit: (value: { releasedOn: string; note: string }) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const today = stockholmDate(Date.now())
  const form = useAppForm({
    defaultValues: { releasedOn: today, note: '' },
    onSubmit: ({ value }) => onSubmit(value),
  })
  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.AppField
        name="releasedOn"
        validators={{
          onSubmit: ({ value }) => {
            if (!isIsoDate(value)) return m.common_date_required()
            const problem = releaseProblem(pledge, value, today)
            if (problem === 'future') return m.pledge_errors_future()
            if (problem === 'before_notice') {
              return m.pledge_errors_before_notice({ date: pledge.notifiedOn })
            }
            return undefined
          },
        }}
      >
        {(field) => <field.TextField label={m.pledge_released_on()} type="date" />}
      </form.AppField>
      <form.AppField name="note">
        {(field) => (
          <field.TextField
            label={<Optional>{m.pledge_release_note()}</Optional>}
            placeholder={m.pledge_release_note_placeholder()}
          />
        )}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton variant="destructive">{m.pledge_release_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Avregistrera" on an active pledge. */
export function useReleasePledgeDrawer(pledge: {
  id: string
  creditorName: string
  notifiedOn: string
  releasedOn: string | null
}) {
  const queryClient = useQueryClient()
  const release = useFormMutation({
    mutationFn: releasePledgeFn,
    onSuccess: () => refresh(queryClient),
  })
  return useFormDrawer({
    title: m.pledge_release_title(),
    description: m.pledge_release_description({ creditor: pledge.creditorName }),
    onClose: release.reset,
    form: ({ close }) => (
      <ReleasePledgeForm
        pledge={pledge}
        onSubmit={async (value) => {
          await release.mutateAsync({ data: { pledgeId: pledge.id, ...value } })
          close()
        }}
      />
    ),
  })
}
