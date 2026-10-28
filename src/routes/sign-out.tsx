import { createFileRoute } from '@tanstack/react-router'
import { SignOut } from '#/components/auth/sign-out'

// Better Auth UI's sign-out view: signs out on arrival, then goes to /login. Cached data belongs
// to the user who is leaving, so it goes first.
export const Route = createFileRoute('/sign-out')({
  beforeLoad: ({ context }) => context.queryClient.clear(),
  component: SignOutPage,
})

function SignOutPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <SignOut />
    </main>
  )
}
