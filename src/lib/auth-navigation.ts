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

export function signedInDestination(
  session: { isAdmin: boolean } | null,
  destination: unknown,
): string | null {
  if (!session) return null
  return session.isAdmin ? '/admin' : authDestination(destination)
}
