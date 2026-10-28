import type { AuthView } from '@better-auth-ui/core'
import { Link, redirect } from '@tanstack/react-router'
import { Auth } from '#/components/auth/auth'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { authDestination, canonicalAuthSearch, signedInDestination } from '#/lib/auth-navigation'
import { m } from '#/paraglide/messages'
import { DevLogins } from './dev-logins'
import { getSessionFn } from './functions'

/** Canonicalize legacy/supplied redirects before the library reads window.location. */
export async function beforeAuthPage(
  location: { pathname: string; searchStr: string },
  signedOutOnly = false,
) {
  const canonical = canonicalAuthSearch(location.searchStr)
  if (canonical !== location.searchStr) {
    throw redirect({ href: `${location.pathname}${canonical}`, replace: true })
  }
  if (signedOutOnly) {
    const destination = signedInDestination(
      await getSessionFn(),
      new URLSearchParams(canonical).get('redirectTo'),
    )
    if (destination) throw redirect({ href: destination })
  }
}

export const authSearch = (
  search: Record<string, unknown>,
): { redirectTo?: string; token?: string; error?: string } => ({
  redirectTo:
    search.redirectTo === undefined && search.redirect === undefined
      ? undefined
      : authDestination(search.redirectTo ?? search.redirect),
  token: typeof search.token === 'string' ? search.token : undefined,
  error: typeof search.error === 'string' ? search.error : undefined,
})

export function PublicAuthPage({
  view,
  invalidResetLink = false,
}: {
  view: AuthView
  invalidResetLink?: boolean
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-4 px-4 py-16 [&_input]:h-11 sm:[&_input]:h-9 [&_[data-slot=input-group]]:h-11 sm:[&_[data-slot=input-group]]:h-9 [&_button]:min-h-11 sm:[&_button]:min-h-0">
      {invalidResetLink ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{m.reset_link_broken()}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p>{m.auth_error_invalid_token()}</p>
            <Link to="/forgot-password" className="underline">
              {m.reset_send_new_link()}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Auth view={view} />
      )}
      {import.meta.env.DEV && view === 'signIn' && <DevLogins />}
    </main>
  )
}
