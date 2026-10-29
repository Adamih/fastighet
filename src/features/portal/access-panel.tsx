import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MailPlus, RotateCw, UserX, X } from 'lucide-react'
import { useState } from 'react'
import { Panel, PanelRow } from '#/components/detail'
import { QueryError } from '#/components/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { formatShortDate } from '#/features/leases/overview'
import { stockholmDate } from '#/lib/dates'
import { m } from '#/paraglide/messages'
import {
  portalAccessQuery,
  resendPortalInvitationFn,
  revokePortalAccessFn,
  revokePortalInvitationFn,
} from './functions'
import { useInvitePortalUserDrawer } from './invite-form'

/**
 * "Mina sidor" on a tenant's page: who can see the party's pages in the portal, invitations not
 * yet used, and inviting, resending and revoking for those who may manage tenants.
 */
export function PortalAccessPanel({
  party,
  canManage,
}: {
  party: { id: string; name: string; email: string | null }
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const access = useQuery(portalAccessQuery(party.id))
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: portalAccessQuery(party.id).queryKey })
  const invite = useInvitePortalUserDrawer(party, ({ email, emailed }) =>
    setNotice(emailed ? m.portal_invite_sent({ email }) : m.portal_invite_not_sent()),
  )
  const resend = useMutation({
    mutationFn: resendPortalInvitationFn,
    onSuccess: async (result) => {
      setNotice(result.emailed ? m.portal_invitation_resent() : m.portal_invite_not_sent())
      await refresh()
    },
  })
  const revokeInvitation = useMutation({ mutationFn: revokePortalInvitationFn, onSuccess: refresh })
  const revokeAccess = useMutation({ mutationFn: revokePortalAccessFn, onSuccess: refresh })
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const error = resend.error ?? revokeInvitation.error ?? revokeAccess.error

  const action = canManage && (
    <Button variant="outline" className="h-11 sm:h-8" onClick={invite.open}>
      <MailPlus aria-hidden="true" />
      {m.portal_invite()}
    </Button>
  )

  if (access.error) {
    return (
      <Panel title={m.portal_access_title()}>
        <QueryError
          error={access.error}
          pending={access.isFetching}
          retry={() => access.refetch()}
        />
      </Panel>
    )
  }
  if (!access.data) return null
  const { users, invitations } = access.data

  return (
    <Panel title={m.portal_access_title()} action={action}>
      {users.length === 0 && invitations.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{m.portal_access_empty()}</p>
      ) : (
        <div>
          {users.map((u) => (
            <PanelRow key={u.id}>
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate font-semibold">{u.name || u.email}</span>
                <span className="truncate text-muted-foreground">
                  {u.email} ·{' '}
                  {m.portal_access_since({
                    date: formatShortDate(stockholmDate(u.createdAt)),
                  })}
                </span>
              </span>
              {canManage &&
                (confirmRevoke === u.id ? (
                  <span className="flex shrink-0 gap-1">
                    <Button
                      variant="destructive"
                      className="h-11 sm:h-8"
                      disabled={revokeAccess.isPending}
                      onClick={() =>
                        revokeAccess.mutate(
                          { data: { accessId: u.id } },
                          { onSettled: () => setConfirmRevoke(null) },
                        )
                      }
                    >
                      {m.portal_access_revoke()}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-8"
                      aria-label={m.common_cancel()}
                      onClick={() => setConfirmRevoke(null)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 sm:size-8"
                    aria-label={m.portal_access_revoke_for({ name: u.name || u.email })}
                    onClick={() => setConfirmRevoke(u.id)}
                  >
                    <UserX aria-hidden="true" />
                  </Button>
                ))}
            </PanelRow>
          ))}
          {invitations.map((i) => (
            <PanelRow key={i.id}>
              <span className="grid min-w-0 gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold">{i.email}</span>
                  <Badge variant={i.status === 'expired' ? 'outline' : 'secondary'}>
                    {i.status === 'expired'
                      ? m.portal_invitation_expired()
                      : m.portal_invitation_pending()}
                  </Badge>
                </span>
                <span className="truncate text-muted-foreground">
                  {m.portal_invitation_line({
                    sent: formatShortDate(i.sentOn),
                    expires: formatShortDate(i.expiresOn),
                  })}
                </span>
              </span>
              {canManage && (
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-8"
                    aria-label={m.portal_invitation_resend()}
                    title={m.portal_invitation_resend()}
                    disabled={resend.isPending}
                    onClick={() => resend.mutate({ data: { invitationId: i.id } })}
                  >
                    <RotateCw aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-8"
                    aria-label={m.portal_invitation_revoke()}
                    title={m.portal_invitation_revoke()}
                    disabled={revokeInvitation.isPending}
                    onClick={() => revokeInvitation.mutate({ data: { invitationId: i.id } })}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </span>
              )}
            </PanelRow>
          ))}
        </div>
      )}
      {notice && <p className="text-[13px] text-muted-foreground">{notice}</p>}
      {error && <p className="text-[13px] text-destructive">{error.message}</p>}
    </Panel>
  )
}
