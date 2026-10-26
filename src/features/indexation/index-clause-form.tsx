import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { FactList, Panel } from '#/components/detail'
import { useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { SubmissionForm } from '#/components/submission-form'
import { Button } from '#/components/ui/button'
import type { UnitKind } from '#/features/properties/unit-kinds'
import { useFormMutation } from '#/lib/form-mutation'
import { formatSekShort } from '#/lib/money'
import { m } from '#/paraglide/messages'
import { removeIndexClauseFn, setIndexClauseFn } from './functions'
import { type ClauseProblem, clauseProblem, defaultBaseMonth, formatKpi, monthLabel } from './rules'

interface Clause {
  sharePercent: number
  baseMonth: string
  adjustmentMonth: number
  floorAtBase: boolean
}

interface ClauseLease {
  id: string
  startDate: string
  termEndDate: string | null
  units: readonly { kind: UnitKind }[]
  indexClause: Clause | null
  indexAdjustments: readonly {
    effectiveDate: string
    kpiMonth: string
    kpiHundredths: number
    baseKpiHundredths: number
    supplementOre: number
  }[]
}

const problemText: Record<ClauseProblem, () => string> = {
  residential: m.index_clause_problem_residential,
  not_fixed_term: m.index_clause_problem_not_fixed_term,
  too_short: m.index_clause_problem_too_short,
}

const months = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: new Date(Date.UTC(2026, i, 1)).toLocaleString('sv-SE', { month: 'long', timeZone: 'UTC' }),
}))

interface ClauseValues {
  sharePercent: string
  baseMonth: string
  adjustmentMonth: string
  floorAtBase: boolean
}

/** The index clause's terms: indexed share, base KPI month, adjustment month and the floor. */
export function IndexClauseForm({
  initial,
  onSubmit,
}: {
  initial: Clause
  onSubmit: (value: Clause) => Promise<unknown>
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues: {
      sharePercent: String(initial.sharePercent),
      baseMonth: initial.baseMonth,
      adjustmentMonth: String(initial.adjustmentMonth),
      floorAtBase: initial.floorAtBase,
    } as ClauseValues,
    onSubmit: ({ value }) =>
      onSubmit({
        sharePercent: Number(value.sharePercent),
        baseMonth: value.baseMonth,
        adjustmentMonth: Number(value.adjustmentMonth),
        floorAtBase: value.floorAtBase,
      }),
  })
  return (
    <SubmissionForm form={form} id={drawer?.formId} className="grid gap-4">
      <form.AppField
        name="sharePercent"
        validators={{
          onSubmit: ({ value }) =>
            /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100
              ? undefined
              : m.index_clause_share_invalid(),
        }}
      >
        {(field) => (
          <field.TextField
            label={m.index_clause_share()}
            hint={m.index_clause_share_hint()}
            inputMode="numeric"
          />
        )}
      </form.AppField>
      <form.AppField
        name="baseMonth"
        validators={{
          onSubmit: ({ value }) =>
            /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? undefined : m.index_clause_base_invalid(),
        }}
      >
        {(field) => (
          <field.TextField
            label={m.index_clause_base_month()}
            hint={m.index_clause_base_hint()}
            type="month"
          />
        )}
      </form.AppField>
      <form.AppField name="adjustmentMonth">
        {(field) => (
          <field.SelectField label={m.index_clause_adjustment_month()} options={months} />
        )}
      </form.AppField>
      <form.AppField name="floorAtBase">
        {(field) => (
          <field.SwitchField
            label={m.index_clause_floor()}
            description={m.index_clause_floor_hint()}
          />
        )}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton>{m.index_clause_submit()}</form.SubmitButton>
      </form.AppForm>
    </SubmissionForm>
  )
}

function useIndexClauseDrawer(lease: ClauseLease) {
  const queryClient = useQueryClient()
  const save = useFormMutation({
    mutationFn: setIndexClauseFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['leases'] }, { throwOnError: true }),
  })
  return useFormDrawer({
    title: m.index_clause_title(),
    description: m.index_clause_description(),
    onClose: save.reset,
    form: ({ close }) => (
      <IndexClauseForm
        initial={
          lease.indexClause ?? {
            sharePercent: 100,
            baseMonth: defaultBaseMonth(lease.startDate),
            adjustmentMonth: 1,
            floorAtBase: true,
          }
        }
        onSubmit={async (value) => {
          await save.mutateAsync({ data: { leaseId: lease.id, ...value } })
          close()
        }}
      />
    ),
  })
}

/**
 * The lease's index clause on its page: its terms and latest adjustment, or why the lease can't
 * have one. Leases of apartments don't show it at all.
 */
export function IndexClausePanel({ lease, canManage }: { lease: ClauseLease; canManage: boolean }) {
  const queryClient = useQueryClient()
  const drawer = useIndexClauseDrawer(lease)
  const remove = useMutation({
    mutationFn: () => removeIndexClauseFn({ data: { leaseId: lease.id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leases'] }),
  })
  const problem = clauseProblem({ ...lease, unitKinds: lease.units.map((u) => u.kind) })
  if (problem === 'residential' && !lease.indexClause) return null
  const clause = lease.indexClause
  const latest = lease.indexAdjustments[0]

  return (
    <Panel
      title={m.index_clause_title()}
      action={
        canManage &&
        !problem && (
          <Button variant="ghost" size="sm" onClick={drawer.open}>
            {clause ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {clause ? m.common_edit() : m.index_clause_add()}
          </Button>
        )
      }
    >
      {clause ? (
        <FactList
          facts={[
            [m.index_clause_share(), `${clause.sharePercent} %`],
            [m.index_clause_base_month(), monthLabel(clause.baseMonth)],
            [m.index_clause_adjustment_month(), months[clause.adjustmentMonth - 1]?.label ?? ''],
            [m.index_clause_floor_short(), clause.floorAtBase ? m.lease_vat_yes() : m.common_no()],
            ...(latest
              ? ([
                  [
                    m.index_clause_latest({ date: latest.effectiveDate }),
                    `${formatSekShort(latest.supplementOre)} ${m.common_per_year()}`,
                  ],
                  [
                    m.index_clause_latest_kpi(),
                    `${formatKpi(latest.kpiHundredths)} (${monthLabel(latest.kpiMonth)}) / ${formatKpi(latest.baseKpiHundredths)}`,
                  ],
                ] as const)
              : []),
          ]}
        />
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {problem ? problemText[problem]() : m.index_clause_none()}
        </p>
      )}
      {clause && problem && (
        <p className="text-[13px] text-destructive">{problemText[problem]()}</p>
      )}
      {clause && canManage && lease.indexAdjustments.length === 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {m.index_clause_remove()}
          </Button>
          {remove.error && <p className="text-destructive text-sm">{remove.error.message}</p>}
        </div>
      )}
    </Panel>
  )
}
