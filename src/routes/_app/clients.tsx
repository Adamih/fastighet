import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { clientsQuery, endClientFn, withdrawRequestFn } from '#/features/management/functions'
import { assignmentRoleLabel, grantSummary } from '#/features/management/grant-levels'
import {
  type StaffMember,
  useAssignStaffDrawer,
  useRequestAccessDrawer,
} from '#/features/management/management-forms'
import { isAssignmentRole } from '#/lib/managed-access'
import { m } from '#/paraglide/messages'

// "Kundbolag": the companies this company manages. Only from the company's own view: a company
// it manages can't be used to reach further (grants don't chain).
export const Route = createFileRoute('/_app/clients')({
  beforeLoad: ({ context }) => {
    if (context.app.organization.grant) {
      throw redirect({ to: '/clients', search: { company: undefined } })
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(clientsQuery()),
  component: ClientsPage,
})

type Clients = typeof Route.types.loaderData

function ClientsPage() {
  const { app } = Route.useRouteContext()
  const { data } = useSuspenseQuery(clientsQuery())
  const manage = useCan()({ client: ['manage'] })
  const request = useRequestAccessDrawer()

  return (
    <div className="grid gap-6 pb-20 md:gap-7 md:pb-0">
      <PageHeader
        title={m.nav_clients()}
        subtitle={m.clients_subtitle({ organization: app.home.name })}
        action={
          manage && (
            <Button size="fab" onClick={request.open}>
              {m.clients_request()}
            </Button>
          )
        }
      />
      <section aria-label={m.nav_clients()} className="overflow-hidden rounded-xl border bg-card">
        {data.clients.length === 0 ? (
          <p className="px-5 py-6 text-muted-foreground text-sm">{m.clients_empty()}</p>
        ) : (
          <ul className="divide-y">
            {data.clients.map((client) => (
              <ClientRow key={client.grantId} client={client} staff={data.staff} manage={manage} />
            ))}
          </ul>
        )}
      </section>
      {data.requests.length > 0 && <Requests requests={data.requests} manage={manage} />}
    </div>
  )
}

function ClientRow({
  client,
  staff,
  manage,
}: {
  client: Clients['clients'][number]
  staff: StaffMember[]
  manage: boolean
}) {
  const assign = useAssignStaffDrawer(client, staff)
  const queryClient = useQueryClient()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const end = useMutation({
    mutationFn: () => endClientFn({ data: { grantId: client.grantId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientsQuery().queryKey })
      // The company switcher lists the clients; it comes from the route context.
      await router.invalidate()
    },
  })
  const assigned = client.assigned.map((a) =>
    a.role && isAssignmentRole(a.role)
      ? `${a.name} (${assignmentRoleLabel[a.role]().toLowerCase()})`
      : a.name,
  )
  return (
    <li className="grid gap-3 px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="grid min-w-0 gap-1">
          <span className="truncate font-semibold">{client.name}</span>
          <span className="text-muted-foreground text-xs">
            {grantSummary(client.grant)} · {m.clients_since({ date: client.since })}
          </span>
          <span className="text-xs">
            {assigned.length > 0 ? assigned.join(', ') : m.clients_assigned_none()}
          </span>
        </div>
        <div className="flex gap-2">
          {manage && (
            <Button
              variant="outline"
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              onClick={assign.open}
            >
              {m.clients_assign()}
            </Button>
          )}
          {manage && (
            <Button
              variant="outline"
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              onClick={() => setConfirming(true)}
            >
              {m.clients_end()}
            </Button>
          )}
          <Button asChild className="h-11 flex-1 sm:h-9 sm:flex-none">
            <Link to="/" search={{ company: client.organizationId }}>
              {m.clients_open()}
            </Link>
          </Button>
        </div>
      </div>
      {confirming && (
        <div
          role="alertdialog"
          aria-label={m.clients_end()}
          className="grid gap-2.5 rounded-lg bg-amber-50 p-3 text-amber-900 text-sm dark:bg-amber-950 dark:text-amber-100"
        >
          <span>{m.clients_end_confirm({ organization: client.name })}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1 sm:h-9"
              disabled={end.isPending}
              onClick={() => setConfirming(false)}
            >
              {m.clients_cancel()}
            </Button>
            <Button
              variant="destructive"
              className="h-11 flex-1 sm:h-9"
              disabled={end.isPending}
              onClick={() => end.mutate()}
            >
              {m.clients_end_yes()}
            </Button>
          </div>
        </div>
      )}
      {end.error && <p className="text-destructive text-sm">{end.error.message}</p>}
    </li>
  )
}

const statusLabel = (r: Clients['requests'][number]) => {
  switch (r.status) {
    case 'open':
      return m.clients_request_status_open()
    case 'used':
      return m.clients_request_status_used({ organization: r.usedBy ?? '' })
    case 'withdrawn':
      return m.clients_request_status_withdrawn()
    case 'expired':
      return m.clients_request_status_expired()
  }
}

function Requests({ requests, manage }: { requests: Clients['requests']; manage: boolean }) {
  const queryClient = useQueryClient()
  const withdraw = useMutation({
    mutationFn: (requestId: string) => withdrawRequestFn({ data: { requestId } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: clientsQuery().queryKey }),
  })
  return (
    <section aria-labelledby="requests" className="overflow-hidden rounded-xl border bg-card">
      <h2 id="requests" className="border-b px-5 py-4 font-bold text-[15px]">
        {m.clients_requests()}
      </h2>
      <ul className="divide-y">
        {requests.map((r) => (
          <li
            key={r.id}
            className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="grid min-w-0 gap-0.5">
              <span className="truncate font-medium text-sm">{r.label}</span>
              <span className="text-muted-foreground text-xs">
                {[
                  statusLabel(r),
                  r.status === 'open' ? m.clients_request_expires({ date: r.expiresOn }) : null,
                  r.email,
                  grantSummary(r.grant),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            {manage && r.status === 'open' && (
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                disabled={withdraw.isPending}
                onClick={() => withdraw.mutate(r.id)}
              >
                {m.clients_request_withdraw()}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {withdraw.error && (
        <p className="border-t px-5 py-3 text-destructive text-sm">{withdraw.error.message}</p>
      )}
    </section>
  )
}
