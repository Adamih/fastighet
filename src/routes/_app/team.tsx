import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { SelectField } from '#/components/select-field'
import { TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { teamQuery } from '#/features/team/functions'
import {
  canManageTeam,
  type InvitableRole,
  invitableRoles,
  roleLabels,
} from '#/features/team/roles'
import { authClient } from '#/lib/auth-client'
import { authErrorMessage } from '#/lib/auth-errors'
import { stockholmDate } from '#/lib/dates'

export const Route = createFileRoute('/_app/team')({
  loader: ({ context }) => context.queryClient.ensureQueryData(teamQuery()),
  component: TeamPage,
})

function TeamPage() {
  const { app } = Route.useRouteContext()
  const { data: team } = useSuspenseQuery(teamQuery())
  const manage = canManageTeam(app.organization.role)

  return (
    <div className="grid gap-8">
      <h1 className="font-semibold text-2xl">Användare</h1>
      <table className="w-full text-left text-sm">
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="py-2 font-medium">Namn</th>
            <th className="py-2 font-medium">E-post</th>
            <th className="py-2 font-medium">Roll</th>
          </tr>
        </thead>
        <tbody>
          {team.members.map((m) => (
            <tr key={m.id} className="border-b">
              <td className="py-2 font-medium">{m.name}</td>
              <td className="py-2">{m.email}</td>
              <td className="py-2">{roleLabels[m.role] ?? m.role}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {team.invitations.length > 0 && (
        <PendingInvitations invitations={team.invitations} manage={manage} />
      )}
      {manage && <InviteForm />}
    </div>
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
          <li key={i.id} className="flex items-center gap-3">
            <span className="font-medium">{i.email}</span>
            <span className="text-muted-foreground">
              {roleLabels[i.role ?? 'member']} · gäller till {stockholmDate(i.expiresAt.getTime())}
            </span>
            {manage && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
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
    <section className="grid max-w-xl gap-4 rounded-lg border p-6">
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
            <Button type="submit" disabled={isSubmitting} className="justify-self-start">
              Skicka inbjudan
            </Button>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
