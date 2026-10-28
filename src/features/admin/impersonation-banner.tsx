import { UserRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { m } from '#/paraglide/messages'

/**
 * Shown across the app while an admin acts as someone (Better Auth's impersonation), with the way
 * back to the admin dashboard. Never printed.
 */
export function ImpersonationBanner({
  user,
}: {
  user: { id: string; name: string; email: string }
}) {
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stop = async () => {
    setStopping(true)
    setError(null)
    const result = await authClient.admin.stopImpersonating()
    if (result.error) {
      setError(authErrorMessage(result.error))
      setStopping(false)
      return
    }
    // A full load drops everything cached as the user.
    window.location.assign(`/admin/users/${user.id}`)
  }
  return (
    <section
      aria-label={m.impersonation_stop()}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-amber-100 px-4 py-2.5 text-amber-950 text-sm print:hidden dark:bg-amber-900 dark:text-amber-50"
    >
      <UserRound aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {m.impersonation_banner({ name: user.name, email: user.email })}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-11 w-full border-amber-950/30 bg-transparent sm:h-8 sm:w-auto"
        disabled={stopping}
        onClick={stop}
      >
        {stopping ? m.impersonation_stopping() : m.impersonation_stop()}
      </Button>
      {error && (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
