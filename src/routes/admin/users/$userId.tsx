import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Ban, LogOut, ShieldCheck, ShieldOff, UserRound } from 'lucide-react'
import { useState } from 'react'
import { DetailHeader, FactList, Panel, PanelRow } from '#/components/detail'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  adminUserQuery,
  banUserFn,
  revokeSessionsFn,
  setAdminFn,
  unbanUserFn,
} from '#/features/admin/functions'
import { roleText, userBadges } from '#/features/admin/labels'
import { submissionError } from '#/lib/app-errors'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { stockholmDate } from '#/lib/dates'
import { IMPERSONATE_WORKSPACE_HEADER } from '#/lib/workspace'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/admin/users/$userId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(adminUserQuery(params.userId)),
  component: UserPage,
})

type User = typeof Route.types.loaderData

function UserPage() {
  const { userId } = Route.useParams()
  const { data: user } = useSuspenseQuery(adminUserQuery(userId))
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] })
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
  })
  const [impersonating, setImpersonating] = useState(false)
  const [impersonateError, setImpersonateError] = useState<string | null>(null)

  // The browser gets the user's session, in the app or in Mina sidor; a full load starts that
  // workspace afresh as them.
  const impersonate = async (workspace: 'staff' | 'portal') => {
    setImpersonating(true)
    setImpersonateError(null)
    const result = await authClient.admin.impersonateUser({
      userId: user.id,
      fetchOptions:
        workspace === 'portal' ? { headers: { [IMPERSONATE_WORKSPACE_HEADER]: 'portal' } } : {},
    })
    if (result.error) {
      setImpersonateError(authErrorMessage(result.error))
      setImpersonating(false)
      return
    }
    window.location.assign(workspace === 'portal' ? '/portal' : '/')
  }

  const mayActAs = !user.isSelf && !user.isAdmin && !user.banned
  const mayImpersonate = mayActAs && user.companies.length > 0
  const mayImpersonatePortal = mayActAs && user.portalAccess > 0
  const error = impersonateError ?? (action.error ? submissionError(action.error).message : null)

  return (
    <div className="grid gap-6">
      <DetailHeader
        back={{ label: m.admin_nav_users(), to: '/admin/users' }}
        crumb={user.name}
        title={user.name}
        meta={[user.email, userBadges(user)].filter(Boolean).join(' · ')}
        actions={
          !user.isSelf && (
            <>
              {(mayImpersonate || !mayImpersonatePortal) && (
                <Button
                  className="flex-1 sm:flex-none"
                  disabled={!mayImpersonate || impersonating}
                  onClick={() => impersonate('staff')}
                >
                  <UserRound aria-hidden="true" />
                  {impersonating ? m.admin_impersonating() : m.admin_impersonate()}
                </Button>
              )}
              {mayImpersonatePortal && (
                <Button
                  variant={mayImpersonate ? 'outline' : 'default'}
                  className="flex-1 sm:flex-none"
                  disabled={impersonating}
                  onClick={() => impersonate('portal')}
                >
                  <UserRound aria-hidden="true" />
                  {impersonating ? m.admin_impersonating() : m.admin_impersonate_portal()}
                </Button>
              )}
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={action.isPending}
                onClick={() => action.mutate(() => revokeSessionsFn({ data: { userId: user.id } }))}
              >
                <LogOut aria-hidden="true" />
                {m.admin_revoke_sessions()}
              </Button>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(() =>
                    setAdminFn({ data: { userId: user.id, admin: !user.isAdmin } }),
                  )
                }
              >
                {user.isAdmin ? (
                  <ShieldOff aria-hidden="true" />
                ) : (
                  <ShieldCheck aria-hidden="true" />
                )}
                {user.isAdmin ? m.admin_remove_admin() : m.admin_make_admin()}
              </Button>
            </>
          )
        }
      />
      {!user.isSelf && !mayImpersonate && !mayImpersonatePortal && !user.isAdmin && (
        <p className="text-[13px] text-muted-foreground">
          {user.banned ? m.admin_impersonate_banned() : m.admin_impersonate_no_company()}
        </p>
      )}
      {user.isAdmin && !user.isSelf && (
        <p className="text-[13px] text-muted-foreground">{m.admin_impersonate_admin()}</p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={m.admin_account()}>
          <FactList
            facts={[
              [m.admin_created(), stockholmDate(user.createdAt)],
              [m.admin_email_verified(), user.emailVerified ? m.common_yes() : m.common_no()],
              ...(user.banned
                ? ([
                    [m.admin_ban_reason(), user.banReason ?? '–'],
                    [
                      m.admin_ban_until(),
                      user.banExpires ? stockholmDate(user.banExpires) : m.admin_ban_forever(),
                    ],
                  ] as const)
                : []),
            ]}
          />
        </Panel>
        <Panel title={m.admin_companies()}>
          {user.companies.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{m.admin_no_companies()}</p>
          ) : (
            <div>
              {user.companies.map((c) => (
                <PanelRow key={c.organizationId}>
                  <Link
                    to="/admin/companies/$organizationId"
                    params={{ organizationId: c.organizationId }}
                    className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">{roleText(c.role)}</span>
                </PanelRow>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={m.admin_sessions()}>
          {user.sessions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{m.admin_no_sessions()}</p>
          ) : (
            <ul className="grid gap-2 text-[13px]">
              {user.sessions.map((s) => (
                <li key={s.id} className="grid gap-0.5">
                  <span className="font-medium">
                    {stockholmDate(s.createdAt)}
                    {s.impersonatedBy && ` · ${m.admin_session_impersonated()}`}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {[s.ipAddress, s.userAgent].filter(Boolean).join(' · ') || '–'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {!user.isSelf && !user.isAdmin && <BanPanel user={user} onDone={refresh} />}
      </div>
    </div>
  )
}

/** Ban with a reason and an optional number of days, or lift the ban. */
function BanPanel({ user, onDone }: { user: User; onDone: () => unknown }) {
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('')
  const ban = useMutation({
    mutationFn: () =>
      banUserFn({
        data: { userId: user.id, reason, days: days.trim() ? Number(days) : null },
      }),
    onSuccess: onDone,
  })
  const unban = useMutation({
    mutationFn: () => unbanUserFn({ data: { userId: user.id } }),
    onSuccess: onDone,
  })
  const error = ban.error ?? unban.error
  return (
    <Panel title={m.admin_ban_title()}>
      {user.banned ? (
        <Button
          variant="outline"
          className="h-11 w-full sm:h-9 sm:w-fit"
          disabled={unban.isPending}
          onClick={() => unban.mutate()}
        >
          {m.admin_unban()}
        </Button>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            ban.mutate()
          }}
        >
          <p className="text-[13px] text-muted-foreground">{m.admin_ban_description()}</p>
          <div className="grid gap-1.5">
            <Label htmlFor="ban-reason">{m.admin_ban_reason()}</Label>
            <Input
              id="ban-reason"
              className="h-11 sm:h-9"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ban-days">{m.admin_ban_days()}</Label>
            <Input
              id="ban-days"
              className="h-11 sm:h-9"
              inputMode="numeric"
              placeholder={m.admin_ban_forever()}
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <Button
            type="submit"
            variant="destructive"
            className="h-11 w-full sm:h-9 sm:w-fit"
            disabled={ban.isPending || !reason.trim()}
          >
            <Ban aria-hidden="true" />
            {m.admin_ban()}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {submissionError(error).message}
        </p>
      )}
    </Panel>
  )
}
