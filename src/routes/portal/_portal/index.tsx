import { createFileRoute } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/portal/_portal/')({
  component: PortalHome,
})

function PortalHome() {
  const { session } = Route.useRouteContext()
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-2 px-4 py-10">
      <h1 className="font-bold text-2xl tracking-tight">{m.portal_access_title()}</h1>
      <p className="text-muted-foreground text-sm">{session.email}</p>
    </main>
  )
}
