import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Mail, Printer } from 'lucide-react'
import { DetailHeader } from '#/components/detail'
import { useAppForm } from '#/components/form'
import { SubmissionForm } from '#/components/submission-form'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { confirmPledgeFn, pledgeConfirmationQuery } from '#/features/pledges/functions'
import { type ConfirmationKind, confirmationKinds } from '#/features/pledges/schemas'
import { submissionError } from '#/lib/app-errors'
import { stockholmDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'

// The förening's confirmation to a lender that its pledge was registered or released: printable
// for the post, or sent by email. Either way the pledge records that it was sent.
export const Route = createFileRoute('/_app/ownerships/$ownershipId_/pledges/$pledgeId')({
  validateSearch: (search): { kind: ConfirmationKind } => ({
    kind: confirmationKinds.includes(search.kind as ConfirmationKind)
      ? (search.kind as ConfirmationKind)
      : 'registered',
  }),
  loaderDeps: ({ search }) => ({ kind: search.kind }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      pledgeConfirmationQuery({ pledgeId: params.pledgeId, kind: deps.kind }),
    ),
  component: ConfirmationPage,
})

function ConfirmationPage() {
  const { ownershipId, pledgeId } = Route.useParams()
  const { kind } = Route.useSearch()
  const { data } = useSuspenseQuery(pledgeConfirmationQuery({ pledgeId, kind }))
  const canManage = useCan()({ lease: ['manage'] })
  const { text } = data

  return (
    <div className="grid gap-6 md:gap-7">
      <DetailHeader
        className="print:hidden"
        back={{
          label: m.pledge_confirmation_back(),
          to: '/ownerships/$ownershipId',
          params: { ownershipId },
        }}
        crumb={m.pledge_confirmation()}
        title={text.title}
        meta={
          data.sentAt
            ? m.pledge_confirmation_sent({ date: stockholmDate(data.sentAt) })
            : m.pledge_confirmation_not_sent()
        }
        actions={
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            {m.extract_print()}
          </Button>
        }
      />
      {canManage && <SendConfirmation pledgeId={pledgeId} kind={kind} email={data.email} />}

      <article className="mx-auto grid w-full max-w-3xl gap-6 rounded-lg border bg-card p-4 shadow-sm sm:p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <p className="text-sm">{text.greeting}</p>
        <h1 className="font-semibold text-2xl">{text.title}</h1>
        <div className="grid gap-3 text-sm leading-relaxed">
          {text.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {text.facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-0.5 text-sm">
          {text.signature.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <footer className="grid gap-0.5 border-t pt-4 text-muted-foreground text-xs">
          {text.sender.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </footer>
      </article>
    </div>
  )
}

/** Email the confirmation, or record that it was printed and posted. */
function SendConfirmation({
  pledgeId,
  kind,
  email,
}: {
  pledgeId: string
  kind: ConfirmationKind
  email: string | null
}) {
  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['ownerships'] }, { throwOnError: true })
  const send = useFormMutation({ mutationFn: confirmPledgeFn, onSuccess: refresh })
  const posted = useMutation({
    mutationFn: () => confirmPledgeFn({ data: { pledgeId, kind, email: '' } }),
    onSuccess: refresh,
  })
  const form = useAppForm({
    defaultValues: { email: email ?? '' },
    onSubmit: async ({ value }) => {
      await send.mutateAsync({ data: { pledgeId, kind, email: value.email } })
    },
  })
  return (
    <section
      aria-label={m.pledge_confirmation_send()}
      className="grid gap-3 rounded-xl border bg-card p-4 print:hidden"
    >
      <SubmissionForm
        form={form}
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      >
        <form.AppField
          name="email"
          validators={{
            onSubmit: ({ value }) =>
              value.trim() ? undefined : m.pledge_confirmation_email_required(),
          }}
        >
          {(field) => <field.TextField label={m.pledge_confirmation_email()} type="email" />}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton>
            <Mail aria-hidden="true" />
            {m.pledge_confirmation_send()}
          </form.SubmitButton>
        </form.AppForm>
      </SubmissionForm>
      {send.isSuccess && (
        <output className="flex items-center gap-2 text-[13px] text-emerald-700 dark:text-emerald-300">
          <Check aria-hidden="true" className="size-4" />
          {m.pledge_confirmation_emailed()}
        </output>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-[13px] text-muted-foreground">
        <span className="min-w-0 flex-1">{m.pledge_confirmation_post_hint()}</span>
        <Button
          variant="outline"
          className="h-11 w-full sm:h-9 sm:w-auto"
          disabled={posted.isPending}
          onClick={() => posted.mutate()}
        >
          {m.pledge_confirmation_mark_posted()}
        </Button>
        {posted.error && (
          <p role="alert" className="w-full text-destructive">
            {submissionError(posted.error).message}
          </p>
        )}
      </div>
    </section>
  )
}
