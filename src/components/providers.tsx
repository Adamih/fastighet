import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AuthProvider } from '#/components/auth/auth-provider'
import { Toaster } from '#/components/ui/sonner'
import { TooltipProvider } from '#/components/ui/tooltip'
import { authBasePaths, authViewPaths } from '#/lib/auth/paths'
import { svSE } from '#/lib/auth/sv-se'
import { authClient } from '#/lib/auth-client'

/**
 * Better Auth UI's provider (account settings, the user button) wired to the router, as its
 * TanStack Start guide does. Its paths (`lib/auth/paths`) point at our own sign-in and password
 * pages, account settings under /account and /sign-out.
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
      emailAndPassword={{ enabled: true, requireEmailVerification: true, forgotPassword: true }}
      // There is no storage for images, and avatars would otherwise go into the database.
      avatar={{ enabled: false }}
    >
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster position="bottom-center" />
    </AuthProvider>
  )
}
