import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

/**
 * Shown on a login page to someone signed in to the other workspace: the app's login with a Mina
 * sidor session, or the reverse. Signing out is the only way across (`src/lib/workspace.ts`).
 */
export function OtherWorkspaceNotice({
  signedInTo,
  email,
}: {
  signedInTo: 'staff' | 'portal'
  email: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const signOut = async () => {
    setPending(true)
    await authClient.signOut()
    await router.invalidate()
    setPending(false)
  }
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          {signedInTo === 'portal' ? m.workspace_signed_in_portal() : m.workspace_signed_in_staff()}
        </CardTitle>
        <CardDescription>
          {signedInTo === 'portal'
            ? m.workspace_signed_in_portal_hint({ email })
            : m.workspace_signed_in_staff_hint({ email })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Button className="h-11 w-full sm:h-9" disabled={pending} onClick={signOut}>
          {m.workspace_sign_out()}
        </Button>
        <Button variant="outline" className="h-11 w-full sm:h-9" asChild>
          <Link to={signedInTo === 'portal' ? '/portal' : '/'}>
            {signedInTo === 'portal' ? m.workspace_back_portal() : m.workspace_back_staff()}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
