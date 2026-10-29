import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { useCan } from '#/features/auth/use-can'
import {
  acceptRequestFn,
  managersQuery,
  previewRequestFn,
  revokeGrantFn,
} from '#/features/management/functions'
import {
  assignmentRoleName,
  GrantLevelsEditor,
  grantSummary,
} from '#/features/management/grant-levels'
import { useEditGrantDrawer } from '#/features/management/management-forms'
import type { GrantLevels } from '#/lib/managed-access'
import { m } from '#/paraglide/messages'

// "Förvaltare": the companies that manage this one. The owner enters a manager's code, sees who
// asks, decides the permissions and approves; later changes or revokes them. Only from the
// company's own view.
export const Route = createFileRoute('/_app/management')({
  validateSearch: (search): { code?: string } => ({
    code: typeof search.code === 'string' && search.code ? search.code.slice(0, 40) : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (context.app.organization.grant) {
      throw redirect({ to: '/management', search: { code: search.code, company: undefined } })
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(managersQuery()),
  component: ManagersPage,
})

type Managers = typeof Route.types.loaderData

function ManagersPage() {
  const { app } = Route.useRouteContext()
  const { data: managers } = useSuspenseQuery(managersQuery())
  const manage = useCan()({ grant: ['manage'] })

  return (
    <div className="grid gap-6 md:gap-7">
      <PageHeader
        title={m.nav_managers()}
        subtitle={m.managers_subtitle({ organization: app.home.name })}
      />
      {manage ? (
        <EnterCode />
      ) : (
        <p className="text-muted-foreground text-sm">{m.managers_view_only()}</p>
      )}
      <section aria-label={m.nav_managers()} className="overflow-hidden rounded-xl border bg-card">
        {managers.length === 0 ? (
          <p className="px-5 py-6 text-muted-foreground text-sm">{m.managers_empty()}</p>
        ) : (
          <ul className="divide-y">
            {managers.map((manager) => (
              <ManagerRow key={manager.grantId} manager={manager} manage={manage} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function EnterCode() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [code, setCode] = useState(search.code ?? '')
  const [levels, setLevels] = useState<GrantLevels | null>(null)
  const [agreement, setAgreement] = useState(false)
  const [approved, setApproved] = useState<string | null>(null)
  const preview = useMutation({
    mutationFn: (code: string) => previewRequestFn({ data: { code } }),
    onSuccess: (request) => {
      setLevels(request.levels)
      setAgreement(false)
      setApproved(null)
    },
  })
  const accept = useMutation({
    mutationFn: () =>
      acceptRequestFn({
        data: { code, levels: levels as GrantLevels, processorAgreement: agreement },
      }),
    onSuccess: async (result) => {
      setApproved(result.managingName)
      setCode('')
      preview.reset()
      setLevels(null)
      await navigate({ to: '/management', search: { code: undefined }, replace: true })
      await queryClient.invalidateQueries({ queryKey: managersQuery().queryKey })
    },
  })
  const request = preview.data
  const error = preview.error ?? accept.error

  return (
    <section aria-labelledby="enter-code" className="grid gap-4 rounded-xl border bg-card p-5">
      <div className="grid gap-1">
        <h2 id="enter-code" className="font-bold text-[15px]">
          {m.managers_code_title()}
        </h2>
        <p className="text-muted-foreground text-sm">{m.managers_code_description()}</p>
      </div>
      {!request && (
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            if (code.trim()) preview.mutate(code)
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="management-code">{m.managers_code()}</Label>
            <Input
              id="management-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXXX-XXXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-11 font-mono sm:h-9"
            />
          </div>
          <Button
            type="submit"
            className="h-11 w-full sm:h-9 sm:w-auto"
            disabled={preview.isPending}
          >
            {m.managers_code_review()}
          </Button>
        </form>
      )}
      {request && levels && (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <p className="font-semibold">
              {m.managers_request_title({ organization: request.managingName })}
            </p>
            <p className="text-sm">
              {m.managers_request_label({ label: request.label, date: request.expiresOn })}
            </p>
            <p className="text-muted-foreground text-sm">{m.managers_request_decide()}</p>
          </div>
          <GrantLevelsEditor value={levels} onChange={setLevels} disabled={accept.isPending} />
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label htmlFor="processor-agreement">{m.managers_processor_agreement()}</Label>
              <span className="text-muted-foreground text-xs">
                {m.managers_processor_agreement_hint()}
              </span>
            </div>
            <Switch id="processor-agreement" checked={agreement} onCheckedChange={setAgreement} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="h-11 w-full sm:h-9 sm:w-auto"
              disabled={!agreement || accept.isPending}
              onClick={() => accept.mutate()}
            >
              {m.managers_approve()}
            </Button>
            <Button
              variant="outline"
              className="h-11 w-full sm:h-9 sm:w-auto"
              disabled={accept.isPending}
              onClick={() => {
                preview.reset()
                accept.reset()
                setLevels(null)
              }}
            >
              {m.managers_cancel()}
            </Button>
          </div>
        </div>
      )}
      {approved && (
        <output className="text-emerald-700 text-sm dark:text-emerald-300">
          {m.managers_approved({ organization: approved })}
        </output>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
    </section>
  )
}

function ManagerRow({ manager, manage }: { manager: Managers[number]; manage: boolean }) {
  const queryClient = useQueryClient()
  const edit = useEditGrantDrawer(manager)
  const [confirming, setConfirming] = useState(false)
  const revoke = useMutation({
    mutationFn: () => revokeGrantFn({ data: { grantId: manager.grantId } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: managersQuery().queryKey }),
  })
  const access = [
    ...(manager.leaders.length > 0
      ? [m.managers_leaders({ names: manager.leaders.join(', ') })]
      : []),
    ...manager.assigned.map((a) => (a.role ? `${a.name} (${assignmentRoleName(a.role)})` : a.name)),
  ]

  return (
    <li className="grid gap-3 px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="grid min-w-0 gap-1">
          <span className="truncate font-semibold">{manager.name}</span>
          <span className="text-sm">{grantSummary(manager.grant)}</span>
          <span className="text-muted-foreground text-xs">
            {m.managers_granted_by({ name: manager.grantedBy ?? '–', date: manager.since })}
          </span>
          <span className="text-xs">
            {m.managers_access()}: {access.join(', ')}
          </span>
        </div>
        {manage && !confirming && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              onClick={edit.open}
            >
              {m.managers_edit()}
            </Button>
            <Button
              variant="outline"
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              onClick={() => setConfirming(true)}
            >
              {m.managers_revoke()}
            </Button>
          </div>
        )}
      </div>
      {confirming && (
        <div
          role="alertdialog"
          aria-label={m.managers_revoke()}
          className="grid gap-2.5 rounded-lg bg-amber-50 p-3 text-amber-900 text-sm dark:bg-amber-950 dark:text-amber-100"
        >
          <span>{m.managers_revoke_confirm({ organization: manager.name })}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1 sm:h-9"
              disabled={revoke.isPending}
              onClick={() => setConfirming(false)}
            >
              {m.managers_cancel()}
            </Button>
            <Button
              variant="destructive"
              className="h-11 flex-1 sm:h-9"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              {m.managers_revoke_yes()}
            </Button>
          </div>
        </div>
      )}
      {revoke.error && <p className="text-destructive text-sm">{revoke.error.message}</p>}
    </li>
  )
}
