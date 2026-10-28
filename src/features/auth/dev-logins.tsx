import { useAuth, useSignInEmail } from '@better-auth-ui/react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { authErrorMessage } from '#/lib/auth-errors'
import { authDestination } from '#/lib/auth-navigation'
import { m } from '#/paraglide/messages'

/** Seed credentials are loaded only on click in development. */
export function DevLogins() {
  const { authClient, navigate, redirectTo } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const signIn = useSignInEmail(authClient, {
    onSuccess: () => navigate({ to: authDestination(redirectTo) }),
    onError: (error) => setError(authErrorMessage(error)),
  })
  return (
    <div className="grid w-full gap-2">
      {(
        [
          ['owner', m.login_dev_owner()],
          ['brf', m.login_dev_brf()],
          ['manager', m.login_dev_manager()],
          ['admin', m.login_dev_admin()],
        ] as const
      ).map(([user, label]) => (
        <Button
          key={user}
          variant="outline"
          className="h-11 border-dashed"
          disabled={signIn.isPending}
          onClick={async () => {
            setError(null)
            const { SEED_PASSWORD, SEED_USERS } = await import('../../../scripts/db-seed-constants')
            signIn.mutate({ email: SEED_USERS[user].email, password: SEED_PASSWORD })
          }}
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
