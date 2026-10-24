import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer } from '#/components/form-drawer'
import { isIsoDate, stockholmDate } from '#/lib/dates'
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
  error,
}: {
  lease: LeaseView
  onSubmit: (value: TerminateValues) => Promise<unknown>
  error: Error | null
}) {
  const form = useAppForm({
    defaultValues: { noticeDate: stockholmDate(Date.now()), moveOutDate: '' },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.AppField
        name="noticeDate"
        validators={{
          onSubmit: ({ value }) => (isIsoDate(value) ? undefined : 'Ange ett datum'),
        }}
      >
        {(field) => <field.TextField label="Uppsägning mottagen" type="date" />}
      </form.AppField>
      <form.AppField name="moveOutDate">
        {(field) => <field.TextField label={<Optional>Annan avflyttning</Optional>} type="date" />}
      </form.AppField>
      <form.Subscribe selector={(s) => s.values.noticeDate}>
        {(noticeDate) =>
          isIsoDate(noticeDate) && (
            <p className="text-sm">
              Tidigaste avflyttning enligt avtalet:{' '}
              <span className="font-medium tabular-nums">
                {earliestMoveOutDate(lease, noticeDate)}
              </span>
              . Fyll i annan avflyttning bara om ni har kommit överens om ett tidigare datum.
            </p>
          )
        }
      </form.Subscribe>
      {error && <p className="text-destructive text-sm">{error.message}</p>}
      <form.AppForm>
        <form.SubmitButton variant="destructive">Registrera uppsägning</form.SubmitButton>
      </form.AppForm>
    </form>
  )
}

/** "Säg upp" on the lease page. */
export function useTerminateLeaseDrawer(lease: LeaseView) {
  const queryClient = useQueryClient()
  const terminate = useMutation({
    mutationFn: terminateLeaseFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: leasesQuery().queryKey })
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })
  return useFormDrawer({
    title: 'Säg upp avtalet',
    description: `Avtal #${lease.number} med ${lease.tenant.name}. Uppsägningstiden är ${lease.noticePeriodMonths} månader.`,
    onClose: terminate.reset,
    form: ({ close }) => (
      <TerminateForm
        lease={lease}
        error={terminate.error}
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
