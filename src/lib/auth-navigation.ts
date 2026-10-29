import { getSafeRedirectTo } from '@better-auth-ui/core'

/** Accept root-relative destinations only; normalize with the library's redirect checks. */
export function authDestination(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/')
    ? getSafeRedirectTo(value, 'https://fastighet.invalid')
    : '/'
}

/** Keep legacy invitation links working and sanitize the URL before AuthProvider reads it. */
export function canonicalAuthSearch(search: string): string {
  const params = new URLSearchParams(search)
  const destination = params.get('redirectTo') ?? params.get('redirect')
  params.delete('redirect')
  if (destination !== null) params.set('redirectTo', authDestination(destination))
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * Where a signed-in visitor of the app's auth pages goes instead. A Mina sidor session stays on
 * the page, which says they are signed in there (the only way across is signing out).
 */
export function signedInDestination(
  session: { isAdmin: boolean; workspace?: 'staff' | 'portal' } | null,
  destination: unknown,
): string | null {
  if (!session || session.workspace === 'portal') return null
  return session.isAdmin ? '/admin' : authDestination(destination)
}

/** Where a Mina sidor login sends the person: a page in the portal, else its start. */
export function portalDestination(value: unknown): string {
  const destination = authDestination(value)
  return destination === '/portal' || destination.startsWith('/portal/') ? destination : '/portal'
}
