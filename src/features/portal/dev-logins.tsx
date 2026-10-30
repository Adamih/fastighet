import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { portalDestination } from '#/lib/auth-navigation'
import { m } from '#/paraglide/messages'
import { devPortalSignInFn } from './dev-login'

/** Development shortcuts to Mina sidor as a seeded tenant or member, like the app's. */
export function PortalDevLogins({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signIn = async (user: 'tenant' | 'brf') => {
    setPending(true)
    setError(null)
    try {
      await devPortalSignInFn({ data: { user } })
      await router.invalidate()
      await router.navigate({ href: portalDestination(redirectTo) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPending(false)
    }
  }
  return (
    <div className="grid w-full max-w-sm gap-2">
      {(
        [
          ['tenant', m.portal_login_dev_tenant()],
          ['brf', m.portal_login_dev_member()],
        ] as const
      ).map(([user, label]) => (
        <Button
          key={user}
          variant="outline"
          className="h-11 border-dashed"
          disabled={pending}
          onClick={() => signIn(user)}
        >
          {label}
        </Button>
      ))}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
