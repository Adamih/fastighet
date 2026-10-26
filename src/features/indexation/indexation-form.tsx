import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { QueryError } from '#/components/query-error'
import { RowMeta, RowTitle } from '#/components/responsive'
import { SubmissionForm } from '#/components/submission-form'
import { stockholmDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { formatSek } from '#/lib/money'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { indexationPreviewQuery, runIndexationFn } from './functions'
import type { IndexationRow, IndexationStatus } from './program'
import { formatKpi, monthLabel } from './rules'

type RunResult = Awaited<ReturnType<typeof runIndexationFn>>

const statusText: Record<Exclude<IndexationStatus, 'ready'>, (r: IndexationRow) => string> = {
  done: () => m.indexation_status_done(),
  missing_kpi: (r) =>
    m.indexation_status_missing_kpi({
      month: monthLabel(r.kpi === null ? r.kpiMonth : r.baseMonth),
    }),
  no_rent: () => m.indexation_status_no_rent(),
  invalid_clause: () => m.indexation_status_invalid(),
}

/** Index adjustments are prepared in the autumn for 1 January, so from October it's next year. */
const defaultYear = () => {
  const today = stockholmDate(Date.now())
  const year = Number(today.slice(0, 4))
  return Number(today.slice(5, 7)) >= 10 ? year + 1 : year
}

/** The yearly indexation: pick the year, see every lease's new supplement, confirm. */
export function IndexationForm({
  onSubmit,
  onDone,
}: {
  onSubmit: (year: number, notify: boolean) => Promise<RunResult>
  onDone: () => void
}) {
  const drawer = useFormDrawerContext()
  const [year, setYear] = useState(defaultYear)
  const [result, setResult] = useState<RunResult | null>(null)
  const preview = useQuery({ ...indexationPreviewQuery(year), enabled: result === null })
  const rows = preview.data ?? []
  const ready = rows.filter((r) => r.status === 'ready')
  const blocked = rows.some((r) => r.status === 'missing_kpi')
  const withoutEmail = ready.filter((r) => !r.hasEmail).length
  const form = useAppForm({
    defaultValues: { notify: true },
    onSubmit: async ({ value }): Promise<void> => {
      if (result) onDone()
      else if (ready.length > 0) setResult(await onSubmit(year, value.notify))
    },
  })
  const thisYear = Number(stockholmDate(Date.now()).slice(0, 4))

  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-5">
      {result ? (
        <section className="grid gap-2 text-sm">
          <p>{m.indexation_done({ count: result.adjusted })}</p>
          {result.notices.sent > 0 && (
            <p>{m.indexation_notices_sent({ count: result.notices.sent })}</p>
          )}
          {result.notices.noEmail > 0 && (
            <p className="text-muted-foreground">
              {m.indexation_notices_no_email({ count: result.notices.noEmail })}
            </p>
          )}
          {result.notices.failed > 0 && (
            <p className="text-destructive">
              {m.indexation_notices_failed({ count: result.notices.failed })}
            </p>
          )}
        </section>
      ) : (
        <>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{m.indexation_year()}</legend>
            {[thisYear, thisYear + 1].map((y) => (
              <button
                key={y}
                type="button"
                aria-pressed={y === year}
                onClick={() => setYear(y)}
                className={cn(
                  'h-11 rounded-lg border px-4 text-sm sm:h-9',
                  y === year ? 'border-foreground bg-foreground text-background' : 'bg-background',
                )}
              >
                {m.indexation_year_option({ year: y })}
              </button>
            ))}
          </fieldset>
          {preview.error ? (
            <QueryError
              error={preview.error}
              pending={preview.isFetching}
              retry={() => preview.refetch()}
            />
          ) : preview.isPending ? (
            <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{m.indexation_none()}</p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {rows.map((r) => (
                <IndexationItem key={r.leaseId} row={r} />
              ))}
            </ul>
          )}
          {blocked && <p className="text-destructive text-sm">{m.indexation_blocked()}</p>}
          {ready.length > 0 && (
            <form.AppField name="notify">
              {(field) => (
                <field.SwitchField
                  label={m.indexation_notify()}
                  description={
                    withoutEmail > 0
                      ? m.indexation_notify_missing({ count: withoutEmail })
                      : m.indexation_notify_hint()
                  }
                />
              )}
            </form.AppField>
          )}
        </>
      )}
      <form.AppForm>
        <form.SubmitButton disabled={!result && (ready.length === 0 || blocked)}>
          {result ? m.reminders_close() : m.indexation_submit({ count: ready.length })}
        </form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

function IndexationItem({ row: r }: { row: IndexationRow }) {
  const muted = r.status !== 'ready'
  const change = r.newSupplementOre === null ? null : r.newSupplementOre - r.currentSupplementOre
  return (
    <li className={cn('grid gap-1 p-3', muted && 'text-muted-foreground')}>
      <RowTitle
        end={
          r.newSupplementOre !== null && (
            <span className="font-medium tabular-nums">
              {formatSek(r.newSupplementOre)} {m.common_per_year()}
            </span>
          )
        }
      >
        <Link
          to="/leases/$leaseId"
          params={{ leaseId: r.leaseId }}
          className="underline-offset-4 hover:underline"
        >
          {r.tenantName}
        </Link>
      </RowTitle>
      <RowMeta>
        {[
          m.lease_number({ number: r.number }),
          m.indexation_from({ date: r.effectiveDate }),
          m.indexation_base_rent({ amount: formatSek(r.baseRentPerYearOre) }),
          r.kpi !== null &&
            r.baseKpi !== null &&
            m.indexation_kpi({
              kpi: formatKpi(r.kpi),
              month: monthLabel(r.kpiMonth),
              base: formatKpi(r.baseKpi),
            }),
          change !== null &&
            r.status === 'ready' &&
            m.indexation_change({
              amount: `${change >= 0 ? '+' : '−'}${formatSek(Math.abs(change))}`,
            }),
          r.status !== 'ready' && statusText[r.status](r),
        ]
          .filter(Boolean)
          .join(' · ')}
      </RowMeta>
    </li>
  )
}

/** "Indexuppräkning" on the leases page. */
export function useIndexationDrawer() {
  const queryClient = useQueryClient()
  const run = useFormMutation({
    mutationFn: runIndexationFn,
    onSuccess: async () => {
      for (const queryKey of [['leases'], ['invoices']]) {
        await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
      }
    },
  })
  return useFormDrawer({
    size: 'wide',
    title: m.indexation_title(),
    description: m.indexation_description(),
    onClose: run.reset,
    form: ({ close }) => (
      <IndexationForm
        onSubmit={(year, notify) => run.mutateAsync({ data: { year, notify } })}
        onDone={close}
      />
    ),
  })
}
