import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  desktopTableClass,
  MobileList,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
import { SelectField } from '#/components/select-field'
import { TextField } from '#/components/text-field'
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
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { stockholmDate } from '#/lib/dates'

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
  const refresh = () => queryClient.invalidateQueries({ queryKey: teamQuery().queryKey })
  const changeRole = useMutation({
    mutationFn: async (input: { memberId: string; role: Role }) => {
      const result = await authClient.organization.updateMemberRole({
        ...input,
        organizationId: app.organization.id,
      })
      if (result.error) throw new Error(authErrorMessage(result.error))
    },
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: async (memberId: string) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: app.organization.id,
      })
      if (result.error) throw new Error(authErrorMessage(result.error))
    },
    onSettled: refresh,
  })
  const error = changeRole.error ?? remove.error

  return (
    <div className="grid gap-6 sm:gap-8">
      <PageHeader
        title="Användare"
        subtitle={`${team.members.length} ${team.members.length === 1 ? 'person har' : 'personer har'} åtkomst`}
      />
      <div className="grid gap-2">
        <MobileList>
          {team.members.map((m) => (
            <MemberRow
              layout="card"
              key={m.id}
              member={m}
              manage={manage}
              busy={changeRole.isPending || remove.isPending}
              actions={memberActions({
                actorRole: app.organization.role,
                targetRole: m.role,
                ownerCount,
                isSelf: m.isSelf,
              })}
              onRoleChange={(role) => changeRole.mutate({ memberId: m.id, role })}
              onRemove={() => remove.mutate(m.id)}
            />
          ))}
        </MobileList>
        <table className={desktopTableClass}>
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Namn</th>
              <th className="py-2 font-medium">E-post</th>
              <th className="py-2 font-medium">Roll</th>
              {manage && <th className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {team.members.map((m) => (
              <MemberRow
                layout="row"
                key={m.id}
                member={m}
                manage={manage}
                busy={changeRole.isPending || remove.isPending}
                actions={memberActions({
                  actorRole: app.organization.role,
                  targetRole: m.role,
                  ownerCount,
                  isSelf: m.isSelf,
                })}
                onRoleChange={(role) => changeRole.mutate({ memberId: m.id, role })}
                onRemove={() => remove.mutate(m.id)}
              />
            ))}
          </tbody>
        </table>
        {error && <p className="text-destructive text-sm">{error.message}</p>}
      </div>

      {team.invitations.length > 0 && (
        <PendingInvitations
          invitations={team.invitations}
          manage={can({ invitation: ['cancel'] })}
        />
      )}
      {can({ invitation: ['create'] }) && <InviteForm />}
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
  layout,
}: {
  member: TeamMember
  manage: boolean
  busy: boolean
  actions: ReturnType<typeof memberActions>
  onRoleChange: (role: Role) => void
  onRemove: () => void
  /** `row` for the table from `md` up, `card` for the phone list. */
  layout: 'row' | 'card'
}) {
  const [confirming, setConfirming] = useState(false)
  const card = layout === 'card'

  const name = (
    <>
      {member.name}
      {member.isSelf && <span className="font-normal text-muted-foreground"> (du)</span>}
    </>
  )
  const role =
    actions.roleOptions.length > 0 ? (
      <Select value={member.role} disabled={busy} onValueChange={(r) => onRoleChange(r as Role)}>
        <SelectTrigger
          size="sm"
          className={card ? 'h-11 w-full' : 'w-40'}
          aria-label={`Roll för ${member.name}`}
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
    ) : (
      (roleLabels[member.role] ?? member.role)
    )
  const remove =
    manage &&
    actions.canRemove &&
    (confirming ? (
      <span className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-muted-foreground">Ta bort {member.name}?</span>
        <Button
          variant="destructive"
          size="sm"
          className={card ? 'h-11' : undefined}
          disabled={busy}
          onClick={onRemove}
        >
          Ta bort
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={card ? 'h-11' : undefined}
          onClick={() => setConfirming(false)}
        >
          Avbryt
        </Button>
      </span>
    ) : (
      <Button
        variant="outline"
        size="sm"
        className={card ? 'h-11' : undefined}
        onClick={() => setConfirming(true)}
      >
        Ta bort
      </Button>
    ))

  if (card) {
    return (
      <li className="grid gap-3 px-4 py-3">
        <span className="grid min-w-0 gap-1">
          <RowTitle
            end={
              actions.roleOptions.length === 0 && (
                <span className="text-muted-foreground text-sm">{role}</span>
              )
            }
          >
            {name}
          </RowTitle>
          <RowMeta>{member.email}</RowMeta>
        </span>
        {actions.roleOptions.length > 0 && (
          <div className="grid gap-1.5 text-sm">
            <span aria-hidden="true" className="text-muted-foreground">
              Roll
            </span>
            {role}
          </div>
        )}
        {remove && <span className="flex justify-end">{remove}</span>}
      </li>
    )
  }

  return (
    <tr className="border-b">
      <td className="py-2 font-medium">{name}</td>
      <td className="py-2">{member.email}</td>
      <td className="py-2">{role}</td>
      {manage && <td className="py-2 text-right">{remove}</td>}
    </tr>
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
      if (result.error) throw new Error(authErrorMessage(result.error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamQuery().queryKey }),
  })

  return (
    <section className="grid gap-3">
      <h2 className="font-medium text-lg">Väntande inbjudningar</h2>
      <ul className="grid gap-2 text-sm">
        {invitations.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{i.email}</span>
            <span className="text-muted-foreground">
              {roleLabels[i.role ?? 'member']} · gäller till {stockholmDate(i.expiresAt.getTime())}
            </span>
            {manage && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-11 sm:h-8"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(i.id)}
              >
                Återkalla
              </Button>
            )}
          </li>
        ))}
      </ul>
      {cancel.error && <p className="text-destructive text-sm">{cancel.error.message}</p>}
    </section>
  )
}

function InviteForm() {
  const queryClient = useQueryClient()
  const invite = useMutation({
    mutationFn: async (value: { email: string; role: InvitableRole }) => {
      const result = await authClient.organization.inviteMember(value)
      if (result.error) throw new Error(authErrorMessage(result.error))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamQuery().queryKey }),
  })

  const form = useForm({
    defaultValues: { email: '', role: 'member' as InvitableRole },
    onSubmit: async ({ value, formApi }) => {
      await invite.mutateAsync({ email: value.email.trim(), role: value.role })
      formApi.reset()
    },
  })

  return (
    <section className="grid max-w-xl gap-4 rounded-lg border p-4 sm:p-6">
      <h2 className="font-medium text-lg">Bjud in en kollega</h2>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <form.Field
            name="email"
            validators={{
              onSubmit: ({ value }) =>
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
                  ? undefined
                  : 'Ange en e-postadress',
            }}
          >
            {(field) => <TextField field={field} label="E-post" type="email" />}
          </form.Field>
          <form.Field name="role">
            {(field) => (
              <SelectField
                field={field}
                label="Roll"
                options={invitableRoles.map((r) => ({ value: r, label: roleLabels[r] }))}
              />
            )}
          </form.Field>
        </div>
        <p className="text-muted-foreground text-sm">
          Administratörer kan också bjuda in och ta bort användare.
        </p>
        {invite.error && <p className="text-destructive text-sm">{invite.error.message}</p>}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-11 w-full sm:h-9 sm:w-auto sm:justify-self-start"
            >
              Skicka inbjudan
            </Button>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
