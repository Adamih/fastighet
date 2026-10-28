import { createFileRoute, redirect } from '@tanstack/react-router'
import { OrganizationPeople } from '#/components/auth/organization/organization-people'
import { PageHeader } from '#/components/responsive'
import { m } from '#/paraglide/messages'

// The company's users and invitations: Better Auth UI's people view (organization plugin), on
// the session's active company, which is always the home company here. Better Auth's endpoints
// decide who may invite, change roles or remove, and its hooks write the audit log.
export const Route = createFileRoute('/_app/team')({
  // A company's team is its own; staff managing it see their own team instead.
  beforeLoad: ({ context }) => {
    if (context.app.organization.grant) {
      throw redirect({ to: '/team', search: { company: undefined } })
    }
  },
  component: TeamPage,
})

function TeamPage() {
  const { app } = Route.useRouteContext()
  return (
    <div className="grid gap-6 md:gap-7">
      <PageHeader
        title={m.nav_team()}
        subtitle={m.team_access_organization({ organization: app.organization.name })}
      />
      <OrganizationPeople />
    </div>
  )
}
