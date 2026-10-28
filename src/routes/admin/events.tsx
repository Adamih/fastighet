import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { PageHeader } from '#/components/responsive'
import { adminActions, isAdminAction } from '#/features/admin/actions'
import { adminEventsQuery } from '#/features/admin/functions'
import { isTierId, tiers } from '#/features/billing/tiers'
import { m } from '#/paraglide/messages'

// What admins did: impersonations, bans, roles, tiers by agreement. The latest 200.
export const Route = createFileRoute('/admin/events')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminEventsQuery()),
  component: EventsPage,
})

const time = (ms: number) =>
  new Date(ms).toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    dateStyle: 'short',
    timeStyle: 'short',
  })

/** The plain values worth showing: a ban's reason and days, a tier, a role. */
function detailText(action: string, details: Record<string, string>) {
  if (action === 'ban') {
    return [details.reason, details.days && m.admin_ban_days_value({ days: details.days })]
      .filter(Boolean)
      .join(' · ')
  }
  if (action === 'set_plan') {
    const tier = details.tier ?? ''
    return isTierId(tier) ? tiers[tier].name() : m.admin_override_none()
  }
  if (action === 'set_role') {
    return details.admin === 'true' ? m.admin_make_admin() : m.admin_remove_admin()
  }
  return ''
}

function EventsPage() {
  const { data: events } = useSuspenseQuery(adminEventsQuery())
  return (
    <div className="grid gap-5">
      <PageHeader title={m.admin_nav_events()} />
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">{m.admin_no_events()}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {events.map((e) => (
            <li key={e.id} className="grid gap-0.5 px-4 py-3 text-sm">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>
                  <span className="font-medium">{e.actorName}</span>{' '}
                  {isAdminAction(e.action) ? adminActions[e.action]().toLowerCase() : e.action}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {time(e.createdAt)}
                </span>
              </span>
              <span className="text-muted-foreground">
                {e.targetUserId && (
                  <Link
                    to="/admin/users/$userId"
                    params={{ userId: e.targetUserId }}
                    className="underline-offset-4 hover:underline"
                  >
                    {e.targetUserName ?? e.targetUserId}
                  </Link>
                )}
                {e.targetOrganizationId && (
                  <Link
                    to="/admin/companies/$organizationId"
                    params={{ organizationId: e.targetOrganizationId }}
                    className="underline-offset-4 hover:underline"
                  >
                    {e.targetOrganizationName ?? e.targetOrganizationId}
                  </Link>
                )}
                {detailText(e.action, e.details) && ` · ${detailText(e.action, e.details)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
