import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useFormDrawer } from '#/components/form-drawer'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { isIsoDate, stockholmDate } from '#/lib/dates'
import { leasesQuery, terminateLeaseFn } from './functions'
import type { LeaseView } from './program'
import { earliestMoveOutDate } from './terms'

/** Registers a termination: when notice was received and, if agreed, an earlier move-out. */
export function TerminateForm({ lease, onDone }: { lease: LeaseView; onDone: () => void }) {
  const queryClient = useQueryClient()
  const terminate = useMutation({
    mutationFn: terminateLeaseFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: leasesQuery().queryKey })
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
      onDone()
    },
  })

  const form = useForm({
    defaultValues: { noticeDate: stockholmDate(Date.now()), moveOutDate: '' },
    onSubmit: async ({ value }) => {
      await terminate.mutateAsync({
        data: {
          leaseId: lease.id,
          noticeDate: value.noticeDate,
          moveOutDate: value.moveOutDate || null,
        },
      })
    },
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="grid gap-4">
        <form.Field
          name="noticeDate"
          validators={{
            onSubmit: ({ value }) => (isIsoDate(value) ? undefined : 'Ange ett datum'),
          }}
        >
          {(field) => <TextField field={field} label="Uppsägning mottagen" type="date" />}
        </form.Field>
        <form.Field name="moveOutDate">
          {(field) => <TextField field={field} label="Annan avflyttning (valfritt)" type="date" />}
        </form.Field>
      </div>
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
      {terminate.error && <p className="text-destructive text-sm">{terminate.error.message}</p>}
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button
            type="submit"
            variant="destructive"
            disabled={isSubmitting}
            className="h-11 w-full sm:h-10"
          >
            Registrera uppsägning
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}

/** "Säg upp" on the lease page. */
export function useTerminateLeaseDrawer(lease: LeaseView) {
  return useFormDrawer({
    title: 'Säg upp avtalet',
    description: `Avtal #${lease.number} med ${lease.tenant.name}. Uppsägningstiden är ${lease.noticePeriodMonths} månader.`,
    form: ({ close }) => <TerminateForm lease={lease} onDone={close} />,
  })
}
