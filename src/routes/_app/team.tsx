import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { InitialsAvatar } from '#/components/initials-avatar'
import { PageHeader } from '#/components/responsive'
import { SubmissionForm } from '#/components/submission-form'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { useCan } from '#/features/auth/use-can'
import { teamQuery } from '#/features/team/functions'
import {
  type InvitableRole,
  invitableRoles,
  isOwner,
  memberActions,
  type Role,
  roleLabels,
} from '#/features/team/roles'
import { appError } from '#/lib/app-errors'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { stockholmDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/team')({
  loader: ({ context }) => context.queryClient.ensureQueryData(teamQuery()),
  component: TeamPage,
})

type TeamMember = { id: string; role: string; name: string; email: string; isSelf: boolean }

function TeamPage() {
  const { app } = Route.useRouteContext()
  const { data: team } = useSuspenseQuery(teamQuery())
  const can = useCan()
  const manage = can({ member: ['update'] }) || can({ member: ['delete'] })
  const ownerCount = team.members.filter((m) => isOwner(m.role)).length

  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: teamQuery().queryKey }, { throwOnError: true })
  const changeRole = useMutation({
    mutationFn: async (input: { memberId: string; role: Role }) => {
      const result = await authClient.organization.updateMemberRole({
        ...input,
        organizationId: app.organization.id,
      })
      if (result.error) throw appError('validation', authErrorMessage(result.error))
    },
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: async (memberId: string) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: app.organization.id,
      })
      if (result.error) throw appError('validation', authErrorMessage(result.error))
    },
    onSettled: refresh,
  })
  const error = changeRole.error ?? remove.error

  const rowProps = (m: TeamMember) => ({
    member: m,
    manage,
    busy: changeRole.isPending || remove.isPending,
    actions: memberActions({
      actorRole: app.organization.role,
      targetRole: m.role,
      ownerCount,
      isSelf: m.isSelf,
    }),
    onRoleChange: (role: Role) => changeRole.mutate({ memberId: m.id, role }),
    onRemove: () => remove.mutate(m.id),
  })
  const count = team.members.length

  return (
    <div className="grid gap-6 md:gap-7">
      <PageHeader
        title={m.nav_team()}
        subtitle={
          <>
            <span className="md:hidden">{m.team_access_count({ count })}</span>
            <span className="hidden md:inline">
              {m.team_access_organization({ organization: app.organization.name })}
            </span>
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <section aria-labelledby="members" className="overflow-hidden rounded-xl border bg-card">
            <h2 id="members" className="hidden border-b px-5 py-4 font-bold text-[15px] md:block">
              {m.team_members()}{' '}
              <span className="font-medium text-muted-foreground tabular-nums">{count}</span>
            </h2>
            <ul className="divide-y">
              {team.members.map((m) => (
                <MemberRow key={m.id} {...rowProps(m)} />
              ))}
            </ul>
            {error && (
              <p className="border-t px-5 py-3 text-destructive text-sm">{error.message}</p>
            )}
          </section>

          {team.invitations.length > 0 && (
            <PendingInvitations
              invitations={team.invitations}
              manage={can({ invitation: ['cancel'] })}
            />
          )}
        </div>
        {can({ invitation: ['create'] }) && <InviteForm />}
      </div>
    </div>
  )
}

function MemberRow({
  member,
  manage,
  busy,
  actions,
  onRoleChange,
  onRemove,
}: {
  member: TeamMember
  manage: boolean
  busy: boolean
  actions: ReturnType<typeof memberActions>
  onRoleChange: (role: Role) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const canChangeRole = actions.roleOptions.length > 0
  const canRemove = manage && actions.canRemove
  const roleLabel = roleLabels[member.role] ?? member.role

  const roleSelect = canChangeRole && (
    <Select value={member.role} disabled={busy} onValueChange={(r) => onRoleChange(r as Role)}>
      <SelectTrigger
        className="h-11 w-full min-w-0 flex-1 md:h-9 md:w-40 md:flex-none"
        aria-label={m.team_role_for({ name: member.name })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {actions.roleOptions.map((r) => (
          <SelectItem key={r} value={r}>
            {roleLabels[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <li className="grid gap-3 px-4 py-3.5 md:px-5 md:py-4">
      <div className="flex items-center gap-3 md:gap-4">
        <InitialsAvatar name={member.name} className="size-10 md:size-9" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-semibold text-[15px] md:text-sm">
            {member.name}
            {member.isSelf && (
              <span className="font-medium text-muted-foreground text-xs"> {m.team_you()}</span>
            )}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">{member.email}</span>
        </span>
        {!canChangeRole && (
          <span className="shrink-0 md:w-40">
            <span className="inline-block rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground text-xs md:rounded-md md:px-3 md:py-2">
              {roleLabel}
            </span>
          </span>
        )}
        {/* From md up the role picker sits on the row; on phones it gets its own line. */}
        {roleSelect && <span className="hidden md:block">{roleSelect}</span>}
        {canRemove ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 text-destructive hover:text-destructive md:size-9"
            aria-label={m.team_remove_member({ name: member.name })}
            aria-expanded={confirming}
            onClick={() => setConfirming((c) => !c)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : (
          manage && <span aria-hidden="true" className="hidden w-9 shrink-0 md:block" />
        )}
      </div>
      {roleSelect && (
        <div className="flex items-center gap-3 pl-13 md:hidden">
          <span aria-hidden="true" className="text-[13px] text-muted-foreground">
            {m.team_role()}
          </span>
          {roleSelect}
        </div>
      )}
      {confirming && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg bg-destructive/5 p-3 text-sm md:ml-13">
          <span className="mr-auto">{m.team_remove_confirm({ name: member.name })}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-8"
            onClick={() => setConfirming(false)}
          >
            {m.common_cancel()}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-11 md:h-8"
            disabled={busy}
            onClick={onRemove}
          >
            {m.common_delete()}
          </Button>
        </div>
      )}
    </li>
  )
}

function PendingInvitations({
  invitations,
  manage,
}: {
  invitations: { id: string; email: string; role: string | null; expiresAt: Date }[]
  manage: boolean
}) {
  const queryClient = useQueryClient()
  const cancel = useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({ invitationId })
      if (result.error) throw appError('validation', authErrorMessage(result.error))
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: teamQuery().queryKey }, { throwOnError: true }),
  })

  return (
    <section aria-labelledby="invitations" className="overflow-hidden rounded-xl border bg-card">
      <h2 id="invitations" className="border-b px-4 py-3 font-bold text-[15px] md:px-5 md:py-4">
        {m.team_pending_invitations()}{' '}
        <span className="font-medium text-muted-foreground tabular-nums">{invitations.length}</span>
      </h2>
      <ul className="divide-y text-sm">
        {invitations.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 md:px-5">
            <span className="min-w-0 truncate font-medium">{i.email}</span>
            <span className="text-[13px] text-muted-foreground">
              {m.team_invitation_meta({
                role: roleLabels[i.role ?? 'member'],
                date: stockholmDate(i.expiresAt.getTime()),
              })}
            </span>
            {manage && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-11 sm:h-8"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(i.id)}
              >
                {m.team_revoke()}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {cancel.error && (
        <p className="border-t px-4 py-3 text-destructive text-sm md:px-5">
          {cancel.error.message}
        </p>
      )}
    </section>
  )
}

function InviteForm() {
  const queryClient = useQueryClient()
  const invite = useFormMutation({
    mutationFn: async (value: { email: string; role: InvitableRole }) => {
      const result = await authClient.organization.inviteMember(value)
      if (result.error) throw appError('validation', authErrorMessage(result.error))
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: teamQuery().queryKey }, { throwOnError: true }),
  })

  const form = useAppForm({
    defaultValues: { email: '', role: 'member' as InvitableRole },
    onSubmit: async ({ value, formApi }) => {
      await invite.mutateAsync({ email: value.email.trim(), role: value.role })
      formApi.reset()
    },
  })

  return (
    <section
      aria-labelledby="invite"
      className="grid gap-4 rounded-xl border bg-card p-4 md:max-w-xl md:p-6 xl:max-w-none"
    >
      <h2 id="invite" className="font-bold text-[17px]">
        {m.team_invite_colleague()}
      </h2>
      <SubmissionForm form={form} className="grid gap-4">
        <div className="grid gap-4">
          <form.AppField
            name="email"
            validators={{
              onSubmit: ({ value }) =>
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
                  ? undefined
                  : m.team_email_required(),
            }}
          >
            {(field) => (
              <field.TextField
                label={m.common_email()}
                type="email"
                autoComplete="off"
                placeholder={m.team_email_placeholder()}
              />
            )}
          </form.AppField>
          <form.AppField name="role">
            {(field) => (
              <field.SegmentedField
                label={m.team_role()}
                showLabel
                options={invitableRoles.map((r) => ({ value: r, label: roleLabels[r] }))}
              />
            )}
          </form.AppField>
        </div>
        <p className="rounded-lg bg-muted px-3.5 py-3 text-[13px] text-muted-foreground leading-relaxed">
          {m.team_admin_hint()}
        </p>

        <form.AppForm>
          <form.SubmitButton className="sm:w-full md:h-10">
            {m.team_send_invitation()}
          </form.SubmitButton>
        </form.AppForm>
      </SubmissionForm>
    </section>
  )
}
