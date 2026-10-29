import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { Spinner } from '#/components/ui/spinner'
import { authClient } from '#/lib/auth-client'

// Signing out of Mina sidor ends on the portal's own login page (the app's `/sign-out` goes to
// the app's). Cached data belongs to the person leaving, so it goes first.
export const Route = createFileRoute('/portal/sign-out')({
  beforeLoad: ({ context }) => context.queryClient.clear(),
  component: PortalSignOut,
})

function PortalSignOut() {
  const router = useRouter()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    authClient.signOut().finally(async () => {
      await router.invalidate()
      await router.navigate({ to: '/portal/login', replace: true })
    })
  }, [router])
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <Spinner />
    </main>
  )
}
