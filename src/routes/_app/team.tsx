import { createFileRoute, redirect } from '@tanstack/react-router'
import { OrganizationPeople } from '#/components/auth/organization/organization-people'
import { OrganizationRoles } from '#/components/auth/organization/organization-roles'
import { PageHeader } from '#/components/responsive'
import { useCan } from '#/features/auth/use-can'
import { PlanHint } from '#/features/billing/plan-hint'
import { m } from '#/paraglide/messages'

// The company's users and invitations, and its custom roles: Better Auth UI's people and roles
// views (organization plugin), on the session's active company, which is always the home company
// here. Better Auth's endpoints decide who may invite, change roles or remove, and manage roles;
// our rules for custom roles and the audit log are hooks on them (`lib/auth-config.ts`).
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
  const can = useCan()
  return (
    <div className="grid gap-6 md:gap-7">
      <PageHeader
        title={m.nav_team()}
        subtitle={m.team_access_organization({ organization: app.organization.name })}
      />
      <OrganizationPeople />
      <div className="grid gap-3">
        {/* Roles that exist keep working on any tier; creating and editing them needs one with it. */}
        {can({ ac: ['create'] }) && <PlanHint feature="roles" />}
        <OrganizationRoles organizationId={app.organization.id} />
      </div>
    </div>
  )
}
