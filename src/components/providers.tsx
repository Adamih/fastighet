import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AuthProvider } from '#/components/auth/auth-provider'
import { Toaster } from '#/components/ui/sonner'
import { TooltipProvider } from '#/components/ui/tooltip'
import { organizationPlugin } from '#/lib/auth/organization-plugin'
import { authBasePaths, authViewPaths, organizationViewPaths } from '#/lib/auth/paths'
import { svSE } from '#/lib/auth/sv-se'
import { authClient } from '#/lib/auth-client'
import { appResources } from '#/lib/permissions'
import { m } from '#/paraglide/messages'

/** What the role editor offers: each app resource with "Visa" and "Ändra" (`manage`). */
const rolePermissionRegistry = () => {
  const labels = {
    property: m.role_resource_property(),
    tenant: m.role_resource_tenant(),
    lease: m.role_resource_lease(),
    invoice: m.role_resource_invoice(),
    payment: m.role_resource_payment(),
    settings: m.role_resource_settings(),
    bookkeeping: m.role_resource_bookkeeping(),
  } satisfies Record<(typeof appResources)[number], string>
  return Object.fromEntries(
    appResources.map((resource) => [
      resource,
      {
        label: labels[resource],
        actions: { read: m.role_action_read(), manage: m.role_action_manage() },
      },
    ]),
  )
}

/**
 * Better Auth UI's provider (account settings, the user button) wired to the router, as its
 * TanStack Start guide does. Its paths (`lib/auth/paths`) point at the Auth views,
 * account settings under /account and /sign-out. Its organization plugin provides the
 * Team page's users and invitations; Better Auth enforces what each may do there.
 */
export function Providers({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { queryClient } = useRouteContext({ from: '__root__' })
  return (
    <AuthProvider
      authClient={authClient}
      queryClient={queryClient}
      locale={svSE}
      navigate={navigate}
      // TanStack's Link takes `to`, not `href`.
      Link={({ href, ...props }) => <Link to={href} {...props} />}
      redirectTo="/"
      basePaths={authBasePaths}
      viewPaths={authViewPaths}
      emailAndPassword={{
        enabled: true,
        requireEmailVerification: true,
        forgotPassword: true,
        confirmPassword: true,
      }}
      // There is no storage for images, and avatars would otherwise go into the database.
      avatar={{ enabled: false }}
      plugins={[
        organizationPlugin({
          viewPaths: organizationViewPaths,
          // Companies are created in onboarding, which also sets their type.
          allowOrganizationCreation: false,
          // Our roles are single: owner, admin or member (`lib/permissions.ts`).
          allowMultipleRoles: false,
          hideSlug: true,
          logo: { enabled: false },
          teams: false,
          // Custom roles (Team page, "Roller"): the app's resources only, as the server allows.
          dynamicAccessControl: { enabled: true, permissions: rolePermissionRegistry() },
        }),
      ]}
    >
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster position="bottom-center" />
    </AuthProvider>
  )
}
