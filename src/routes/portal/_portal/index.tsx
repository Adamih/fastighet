import { createFileRoute } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/portal/_portal/')({
  component: PortalOverview,
})

/** Mina sidor's start: who the pages are for, then what is due and what is coming. */
function PortalOverview() {
  const { portal } = Route.useRouteContext()
  const company = portal.company
  if (!company) return null
  return (
    <div className="grid gap-5">
      <header className="grid gap-1">
        <h1 className="font-bold text-2xl tracking-tight md:text-3xl">
          {m.portal_greeting({ name: portal.user.name || portal.user.email })}
        </h1>
        <p className="text-muted-foreground text-sm">
          {m.portal_overview_for({
            parties: company.parties.map((p) => p.name).join(', '),
            company: company.name,
          })}
        </p>
      </header>
    </div>
  )
}
