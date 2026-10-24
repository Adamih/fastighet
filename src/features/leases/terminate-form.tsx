import { useQueryClient } from '@tanstack/react-query'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { isIsoDate, stockholmDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'
import { leasesQuery, terminateLeaseFn } from './functions'
import type { LeaseView } from './program'
import { earliestMoveOutDate } from './terms'

interface TerminateValues {
  noticeDate: string
  /** Blank means the earliest move-out the notice period allows. */
  moveOutDate: string
}

/** Registers a termination: when notice was received and, if agreed, an earlier move-out. */
export function TerminateForm({
  lease,
  onSubmit,
}: {
  lease: LeaseView
  onSubmit: (value: TerminateValues) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues: { noticeDate: stockholmDate(Date.now()), moveOutDate: '' },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.AppField
        name="noticeDate"
        validators={{
          onSubmit: ({ value }) => (isIsoDate(value) ? undefined : m.common_date_required()),
        }}
      >
        {(field) => <field.TextField label={m.terminate_notice_date()} type="date" />}
      </form.AppField>
      <form.AppField name="moveOutDate">
        {(field) => (
          <field.TextField label={<Optional>{m.terminate_move_out()}</Optional>} type="date" />
        )}
      </form.AppField>
      <form.Subscribe selector={(s) => s.values.noticeDate}>
        {(noticeDate) =>
          isIsoDate(noticeDate) && (
            <p className="text-sm">
              {m.terminate_earliest_move_out({ date: earliestMoveOutDate(lease, noticeDate) })}
            </p>
          )
        }
      </form.Subscribe>

      <form.AppForm>
        <form.SubmitButton variant="destructive">{m.terminate_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

/** "Säg upp" on the lease page. */
export function useTerminateLeaseDrawer(lease: LeaseView) {
  const queryClient = useQueryClient()
  const terminate = useFormMutation({
    mutationFn: terminateLeaseFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries(
        { queryKey: leasesQuery().queryKey },
        { throwOnError: true },
      )
      await queryClient.invalidateQueries({ queryKey: ['properties'] }, { throwOnError: true })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] }, { throwOnError: true })
    },
  })
  return useFormDrawer({
    title: m.terminate_title(),
    description: m.terminate_description({
      number: lease.number,
      tenant: lease.tenant.name,
      months: lease.noticePeriodMonths,
    }),
    onClose: terminate.reset,
    form: ({ close }) => (
      <TerminateForm
        lease={lease}
        onSubmit={async (value) => {
          await terminate.mutateAsync({
            data: {
              leaseId: lease.id,
              noticeDate: value.noticeDate,
              moveOutDate: value.moveOutDate || null,
            },
          })
          close()
        }}
      />
    ),
  })
}
