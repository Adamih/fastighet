import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'
import { Optional, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { useFormMutation } from '#/lib/form-mutation'
import type { Grant, GrantLevels } from '#/lib/managed-access'
import { levelsFromGrant } from '#/lib/managed-access'
import type { AssignmentRole } from '#/lib/permissions'
import { m } from '#/paraglide/messages'
import {
  assignStaffFn,
  clientsQuery,
  managersQuery,
  requestAccessFn,
  updateGrantFn,
} from './functions'
import { assignmentRoleLabel, GrantLevelsEditor, presetLevels } from './grant-levels'

const invalidate = (queryClient: ReturnType<typeof useQueryClient>, queryKey: readonly unknown[]) =>
  queryClient.invalidateQueries({ queryKey }, { throwOnError: true })

// --- "Begär åtkomst" (Kundbolag).

type Created = Awaited<ReturnType<typeof requestAccessFn>>

function RequestAccessForm({
  onCreated,
}: {
  onCreated: (created: Created, email: string) => void
}) {
  const drawer = useFormDrawerContext()
  const queryClient = useQueryClient()
  const create = useFormMutation({
    mutationFn: requestAccessFn,
    onSuccess: () => invalidate(queryClient, clientsQuery().queryKey),
  })
  const form = useAppForm({
    defaultValues: { label: '', email: '', levels: presetLevels('full') as GrantLevels },
    onSubmit: async ({ value }) =>
      onCreated(await create.mutateAsync({ data: value }), value.email.trim()),
  })
  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-5">
      <form.AppField name="label">
        {(field) => (
          <field.TextField
            label={m.clients_request_label()}
            hint={m.clients_request_label_hint()}
            autoComplete="organization"
          />
        )}
      </form.AppField>
      <form.AppField name="email">
        {(field) => (
          <field.TextField
            label={<Optional>{m.clients_request_email()}</Optional>}
            hint={m.clients_request_email_hint()}
            type="email"
            autoComplete="email"
          />
        )}
      </form.AppField>
      <section className="grid gap-2">
        <h3 className="font-bold text-[15px]">{m.clients_request_asked()}</h3>
        <form.Field name="levels">
          {(field) => <GrantLevelsEditor value={field.state.value} onChange={field.handleChange} />}
        </form.Field>
      </section>
      <form.AppForm>
        <form.SubmitButton>{m.clients_request_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-1.5">
      <span className="font-medium text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2.5 text-sm">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 sm:h-9"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? m.clients_request_copied() : m.clients_request_copy()}
        </Button>
      </div>
    </div>
  )
}

/** Shown once, right after the request is created: the code is never shown again. */
function RequestCreated({
  created,
  email,
  onDone,
}: {
  created: Created
  email: string
  onDone: () => void
}) {
  const drawer = useFormDrawerContext()
  // Nothing is left to lose: closing shouldn't ask about unsaved changes.
  useLayoutEffect(() => drawer?.report({ changed: false, submitting: false }), [drawer])
  return (
    <div className="grid gap-4">
      <p className="font-bold text-[15px]">{m.clients_request_created()}</p>
      <p className="text-sm">
        {created.emailed
          ? m.clients_request_emailed({ email })
          : email
            ? m.clients_request_email_failed()
            : m.clients_request_send_yourself()}
      </p>
      <CopyRow label={m.clients_request_code()} value={created.code} />
      <CopyRow label={m.clients_request_link()} value={created.link} />
      <p className="text-muted-foreground text-xs">
        {m.clients_request_once({ date: created.expiresOn })}
      </p>
      <Button className="h-11 w-full sm:h-10" onClick={onDone}>
        {m.clients_request_done()}
      </Button>
    </div>
  )
}

export function useRequestAccessDrawer() {
  const [created, setCreated] = useState<{ result: Created; email: string } | null>(null)
  return useFormDrawer({
    size: 'wide',
    title: m.clients_request(),
    description: m.clients_request_description(),
    onClose: () => setCreated(null),
    form: ({ close }) =>
      created ? (
        <RequestCreated created={created.result} email={created.email} onDone={close} />
      ) : (
        <RequestAccessForm onCreated={(result, email) => setCreated({ result, email })} />
      ),
  })
}

// --- "Tilldela" (Kundbolag).

export interface StaffMember {
  userId: string
  name: string
  email: string
  seesAll: boolean
}

const HOME_ROLE = 'home'
type RoleChoice = AssignmentRole | typeof HOME_ROLE

function AssignStaffForm({
  client,
  staff,
  onSaved,
}: {
  client: { organizationId: string; assigned: { userId: string; role: string | null }[] }
  staff: StaffMember[]
  onSaved: () => void
}) {
  const drawer = useFormDrawerContext()
  const queryClient = useQueryClient()
  const save = useFormMutation({
    mutationFn: assignStaffFn,
    onSuccess: () => invalidate(queryClient, clientsQuery().queryKey),
  })
  const others = staff.filter((s) => !s.seesAll)
  const form = useAppForm({
    defaultValues: {
      staff: others.map((s) => {
        const a = client.assigned.find((x) => x.userId === s.userId)
        return {
          userId: s.userId,
          assigned: a !== undefined,
          role: (a?.role ?? HOME_ROLE) as RoleChoice,
        }
      }),
    },
    onSubmit: async ({ value }) => {
      await save.mutateAsync({
        data: {
          managedOrganizationId: client.organizationId,
          staff: value.staff
            .filter((s) => s.assigned)
            .map((s) => ({ userId: s.userId, role: s.role === HOME_ROLE ? null : s.role })),
        },
      })
      onSaved()
    },
  })
  const leaders = staff.filter((s) => s.seesAll)

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <ul className="divide-y rounded-lg border">
        {leaders.map((s) => (
          <li key={s.userId} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0 truncate text-sm">{s.name}</span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {m.clients_assign_sees_all()}
            </span>
          </li>
        ))}
        {others.map((s, i) => (
          <form.Subscribe key={s.userId} selector={(state) => state.values.staff[i]}>
            {(row) => (
              <li className="grid gap-2 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`assign-${s.userId}`} className="grid min-w-0 gap-0 font-normal">
                    <span className="truncate text-sm">{s.name}</span>
                    <span className="truncate text-muted-foreground text-xs">{s.email}</span>
                  </Label>
                  <Switch
                    id={`assign-${s.userId}`}
                    checked={row.assigned}
                    onCheckedChange={(checked) =>
                      form.setFieldValue(`staff[${i}].assigned`, checked)
                    }
                  />
                </div>
                {row.assigned && (
                  <Select
                    value={row.role}
                    onValueChange={(role) =>
                      form.setFieldValue(`staff[${i}].role`, role as RoleChoice)
                    }
                  >
                    <SelectTrigger className="h-11 w-full sm:h-9" aria-label={s.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={HOME_ROLE}>{m.assignment_role_home()}</SelectItem>
                      {(Object.keys(assignmentRoleLabel) as AssignmentRole[]).map((role) => (
                        <SelectItem key={role} value={role}>
                          {assignmentRoleLabel[role]()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </li>
            )}
          </form.Subscribe>
        ))}
      </ul>
      <form.AppForm>
        <form.SubmitButton>{m.clients_assign_save()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

export function useAssignStaffDrawer(
  client: {
    organizationId: string
    name: string
    assigned: { userId: string; role: string | null }[]
  },
  staff: StaffMember[],
) {
  return useFormDrawer({
    title: m.clients_assign_title({ organization: client.name }),
    description: m.clients_assign_description(),
    form: ({ close }) => <AssignStaffForm client={client} staff={staff} onSaved={close} />,
  })
}

// --- "Ändra behörigheter" (Förvaltare).

function EditGrantForm({
  grantId,
  grant,
  onSaved,
}: {
  grantId: string
  grant: Grant
  onSaved: () => void
}) {
  const drawer = useFormDrawerContext()
  const queryClient = useQueryClient()
  const save = useFormMutation({
    mutationFn: updateGrantFn,
    onSuccess: () => invalidate(queryClient, managersQuery().queryKey),
  })
  const form = useAppForm({
    defaultValues: { levels: levelsFromGrant(grant) },
    onSubmit: async ({ value }) => {
      await save.mutateAsync({ data: { grantId, levels: value.levels } })
      onSaved()
    },
  })
  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.Field name="levels">
        {(field) => <GrantLevelsEditor value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.AppForm>
        <form.SubmitButton>{m.managers_save()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

export function useEditGrantDrawer(manager: { grantId: string; name: string; grant: Grant }) {
  return useFormDrawer({
    size: 'wide',
    title: `${m.managers_edit()}: ${manager.name}`,
    description: m.managers_edit_description(),
    form: ({ close }) => (
      <EditGrantForm grantId={manager.grantId} grant={manager.grant} onSaved={close} />
    ),
  })
}
