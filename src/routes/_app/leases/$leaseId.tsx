import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { invoicesQuery } from '#/features/invoicing/functions'
import { periodLabel } from '#/features/invoicing/rules'
import { formatPeriod, formatRent, LeaseStatusBadge } from '#/features/leases/components'
import {
  leaseQuery,
  leasesQuery,
  terminateLeaseFn,
  withdrawTerminationFn,
} from '#/features/leases/functions'
import { invoiceIntervalLabels, tenantKindLabels } from '#/features/leases/options'
import type { LeaseView } from '#/features/leases/program'
import { earliestMoveOutDate } from '#/features/leases/terms'
import { unitKindLabels } from '#/features/properties/unit-kinds'
import { isIsoDate, stockholmDate } from '#/lib/dates'
import { formatSek } from '#/lib/money'

export const Route = createFileRoute('/_app/leases/$leaseId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(leaseQuery(params.leaseId)),
  component: LeasePage,
})

function LeasePage() {
  const { leaseId } = Route.useParams()
  const { data: lease } = useSuspenseQuery(leaseQuery(leaseId))

  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <Link to="/leases" className="text-muted-foreground text-sm hover:underline">
          ← Avtal
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-semibold text-2xl">Avtal {lease.number}</h1>
          <LeaseStatusBadge status={lease.status} />
          <Button variant="outline" size="sm" asChild>
            <Link to="/leases/$leaseId/edit" params={{ leaseId }}>
              Ändra
            </Link>
          </Button>
        </div>
        <p className="text-muted-foreground">
          <Link
            to="/tenants/$tenantId"
            params={{ tenantId: lease.tenant.id }}
            className="underline-offset-4 hover:underline"
          >
            {lease.tenant.name}
          </Link>{' '}
          ({tenantKindLabels[lease.tenant.kind].toLowerCase()})
        </p>
      </div>

      <dl className="grid max-w-2xl grid-cols-[12rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Period</dt>
        <dd className="tabular-nums">{formatPeriod(lease)}</dd>
        <dt className="text-muted-foreground">Uppsägningstid</dt>
        <dd>{lease.noticePeriodMonths} månader</dd>
        <dt className="text-muted-foreground">Hyra</dt>
        <dd className="tabular-nums">{formatRent(lease)}</dd>
        <dt className="text-muted-foreground">Avisering</dt>
        <dd>{invoiceIntervalLabels[lease.invoiceInterval]}</dd>
        {lease.noticeDate && (
          <>
            <dt className="text-muted-foreground">Uppsagt</dt>
            <dd className="tabular-nums">
              {lease.noticeDate}, avflyttning {lease.moveOutDate}
            </dd>
          </>
        )}
      </dl>

      <section className="grid gap-3">
        <h2 className="font-medium text-lg">Objekt</h2>
        <ul className="grid gap-1 text-sm">
          {lease.units.map((u) => (
            <li key={u.id}>
              <Link
                to="/properties/$propertyId"
                params={{ propertyId: u.propertyId }}
                className="underline-offset-4 hover:underline"
              >
                {u.designation}
              </Link>{' '}
              · <span className="font-medium">{u.label}</span>{' '}
              <span className="text-muted-foreground">({unitKindLabels[u.kind]})</span>
            </li>
          ))}
        </ul>
      </section>

      <LeaseInvoices leaseId={lease.id} />

      {!lease.moveOutDate && lease.status !== 'ended' && <TerminateForm lease={lease} />}
      {lease.moveOutDate && lease.status !== 'ended' && <WithdrawTermination lease={lease} />}
    </div>
  )
}

function WithdrawTermination({ lease }: { lease: LeaseView }) {
  const queryClient = useQueryClient()
  const withdraw = useMutation({
    mutationFn: withdrawTerminationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: leasesQuery().queryKey })
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
      await queryClient.invalidateQueries({ queryKey: ['tenants'] })
    },
  })

  return (
    <section className="grid max-w-xl gap-3 rounded-lg border p-6">
      <h2 className="font-medium text-lg">Uppsägning</h2>
      <p className="text-sm">
        Avtalet sades upp {lease.noticeDate} med avflyttning {lease.moveOutDate}. Om hyresgästen
        stannar kan du ångra uppsägningen fram till avflyttningsdagen.
      </p>
      {withdraw.error && <p className="text-destructive text-sm">{withdraw.error.message}</p>}
      <Button
        variant="outline"
        className="justify-self-start"
        disabled={withdraw.isPending}
        onClick={() => withdraw.mutate({ data: { leaseId: lease.id } })}
      >
        Ångra uppsägning
      </Button>
    </section>
  )
}

function LeaseInvoices({ leaseId }: { leaseId: string }) {
  const { data: invoices } = useQuery(invoicesQuery({ filter: 'all', leaseId }))
  if (!invoices || invoices.length === 0) return null

  return (
    <section className="grid gap-3">
      <h2 className="font-medium text-lg">Avier</h2>
      <table className="w-full max-w-2xl text-left text-sm">
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} className="border-b">
              <td className="py-2 tabular-nums">
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: i.id }}
                  className="underline-offset-4 hover:underline"
                >
                  {i.number}
                </Link>
              </td>
              <td className="py-2">{periodLabel({ start: i.periodStart, end: i.periodEnd })}</td>
              <td className="py-2 text-right tabular-nums">{formatSek(i.totalOre)}</td>
              <td className="py-2 pl-4">
                <InvoiceStatusBadge status={i.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TerminateForm({ lease }: { lease: LeaseView }) {
  const queryClient = useQueryClient()
  const terminate = useMutation({
    mutationFn: terminateLeaseFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: leasesQuery().queryKey })
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
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
    <section className="grid max-w-xl gap-4 rounded-lg border p-6">
      <h2 className="font-medium text-lg">Säg upp avtalet</h2>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field
            name="noticeDate"
            validators={{
              onSubmit: ({ value }) => (isIsoDate(value) ? undefined : 'Ange ett datum'),
            }}
          >
            {(field) => <TextField field={field} label="Uppsägning mottagen" type="date" />}
          </form.Field>
          <form.Field name="moveOutDate">
            {(field) => (
              <TextField field={field} label="Annan avflyttning (valfritt)" type="date" />
            )}
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
              className="justify-self-start"
            >
              Registrera uppsägning
            </Button>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
