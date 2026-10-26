import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Schema } from 'effect'
import { AlertTriangle, Download } from 'lucide-react'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import {
  desktopTableClass,
  FilterChips,
  filterChipClass,
  MobileList,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
import { SubmissionForm } from '#/components/submission-form'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useCan } from '#/features/auth/use-can'
import { type AccountKey, accountKeys } from '#/features/bookkeeping/accounts'
import {
  bookkeepingExportsQuery,
  bookkeepingSettingsQuery,
  exportSieFn,
  previewExportQuery,
  updateBookkeepingSettingsFn,
} from '#/features/bookkeeping/functions'
import { UpdateBookkeepingSettingsInput } from '#/features/bookkeeping/schemas'
import { financialYear } from '#/features/bookkeeping/sie'
import { addMonths, endOfMonth, isIsoDate, stockholmDate } from '#/lib/dates'
import { useFormMutation } from '#/lib/form-mutation'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/bookkeeping')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(bookkeepingSettingsQuery()),
      context.queryClient.ensureQueryData(bookkeepingExportsQuery()),
    ]),
  component: BookkeepingPage,
})

type Period = { fromDate: string; toDate: string }
type Preset = 'last_month' | 'this_month' | 'year_to_date' | 'last_year'

/** The periods offered as chips, from today and the financial year's first month. */
function presets(today: string, startMonth: number): Record<Preset, Period> {
  const thisMonth = `${today.slice(0, 7)}-01`
  const lastMonth = addMonths(thisMonth, -1)
  const year = financialYear(today, startMonth)
  const previous = financialYear(addMonths(year.start, -1), startMonth)
  return {
    last_month: { fromDate: lastMonth, toDate: endOfMonth(lastMonth) },
    this_month: { fromDate: thisMonth, toDate: today },
    year_to_date: { fromDate: year.start, toDate: today },
    last_year: { fromDate: previous.start, toDate: previous.end },
  }
}

const presetLabels: Record<Preset, () => string> = {
  last_month: m.bookkeeping_preset_last_month,
  this_month: m.bookkeeping_preset_this_month,
  year_to_date: m.bookkeeping_preset_year_to_date,
  last_year: m.bookkeeping_preset_last_year,
}

function BookkeepingPage() {
  const { data: settings } = useSuspenseQuery(bookkeepingSettingsQuery())
  const today = stockholmDate(Date.now())
  const options = presets(today, settings.financialYearStartMonth)
  const [period, setPeriod] = useState<Period>(options.last_month)
  const valid =
    isIsoDate(period.fromDate) && isIsoDate(period.toDate) && period.fromDate <= period.toDate

  return (
    <div className="grid max-w-4xl gap-6 sm:gap-8">
      <PageHeader title={m.nav_bookkeeping()} subtitle={m.bookkeeping_subtitle()} />

      <section className="grid gap-4">
        <h2 className="font-medium text-lg">{m.bookkeeping_export_title()}</h2>
        <FilterChips label={m.bookkeeping_period()}>
          {(Object.keys(options) as Preset[]).map((key) => {
            const active =
              options[key].fromDate === period.fromDate && options[key].toDate === period.toDate
            return (
              <button
                key={key}
                type="button"
                className={filterChipClass(active)}
                aria-pressed={active}
                onClick={() => setPeriod(options[key])}
              >
                {presetLabels[key]()}
              </button>
            )
          })}
        </FilterChips>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <DateInput
            label={m.bookkeeping_from()}
            value={period.fromDate}
            onChange={(fromDate) => setPeriod((p) => ({ ...p, fromDate }))}
          />
          <DateInput
            label={m.bookkeeping_to()}
            value={period.toDate}
            onChange={(toDate) => setPeriod((p) => ({ ...p, toDate }))}
          />
        </div>
        {valid ? (
          <Preview period={period} />
        ) : (
          <p className="text-destructive text-sm">{m.bookkeeping_invalid_period()}</p>
        )}
      </section>

      <ExportHistory />
      <AccountsForm />
    </div>
  )
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = `bookkeeping-${label}`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        className="h-11 sm:h-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** Downloads base64 bytes as a file. */
function download(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=ibm437' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function Preview({ period }: { period: Period }) {
  const queryClient = useQueryClient()
  const preview = useQuery(previewExportQuery(period))
  const exportFile = useMutation({
    mutationFn: () => exportSieFn({ data: period }),
    onSuccess: async (file) => {
      download(file.fileName, file.base64)
      await queryClient.invalidateQueries({ queryKey: ['bookkeeping'] })
    },
  })

  if (preview.isPending)
    return <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
  if (preview.error) return <p className="text-destructive text-sm">{preview.error.message}</p>
  const data = preview.data

  return (
    <div className="grid gap-4">
      <p className="text-sm">
        {data.voucherCount === 0
          ? m.bookkeeping_nothing()
          : m.bookkeeping_summary({
              count: data.voucherCount,
              invoices: data.series.F,
              credits: data.series.K,
              payments: data.series.B,
            })}
      </p>
      {data.overlapping.length > 0 && (
        <p className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px]">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {m.bookkeeping_overlap({
            periods: data.overlapping.map((e) => `${e.fromDate} – ${e.toDate}`).join(', '),
          })}
        </p>
      )}
      {data.totals.length > 0 && (
        <>
          <MobileList>
            {data.totals.map((t) => (
              <li key={t.account.number} className="grid gap-1 p-3">
                <RowTitle>
                  {t.account.number} {t.account.name}
                </RowTitle>
                <RowMeta>
                  {m.bookkeeping_debit()} {formatSek(t.debitOre)} · {m.bookkeeping_credit()}{' '}
                  {formatSek(t.creditOre)}
                </RowMeta>
              </li>
            ))}
          </MobileList>
          <table className={desktopTableClass}>
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">{m.bookkeeping_account()}</th>
                <th className="py-2 text-right font-medium">{m.bookkeeping_debit()}</th>
                <th className="py-2 text-right font-medium">{m.bookkeeping_credit()}</th>
              </tr>
            </thead>
            <tbody>
              {data.totals.map((t) => (
                <tr key={t.account.number} className="border-b last:border-0">
                  <td className="py-2">
                    <span className="tabular-nums">{t.account.number}</span> {t.account.name}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {t.debitOre ? formatSek(t.debitOre) : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {t.creditOre ? formatSek(t.creditOre) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {exportFile.error && <p className="text-destructive text-sm">{exportFile.error.message}</p>}
      <Button
        type="button"
        className="h-11 w-full sm:h-9 sm:w-fit"
        disabled={data.voucherCount === 0 || exportFile.isPending}
        onClick={() => exportFile.mutate()}
      >
        <Download aria-hidden="true" />
        {m.bookkeeping_download()}
      </Button>
      <p className="text-muted-foreground text-xs">{m.bookkeeping_download_hint()}</p>
    </div>
  )
}

function ExportHistory() {
  const { data: exports } = useSuspenseQuery(bookkeepingExportsQuery())
  if (exports.length === 0) return null
  return (
    <section className="grid gap-2">
      <h2 className="font-medium text-lg">{m.bookkeeping_history()}</h2>
      <ul className="grid gap-1 text-sm">
        {exports.map((e) => (
          <li key={e.id} className="text-muted-foreground">
            {e.createdAt.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })} ·{' '}
            <span className="text-foreground">
              {e.fromDate} – {e.toDate}
            </span>{' '}
            · {m.bookkeeping_vouchers({ count: e.voucherCount })}
            {e.exportedBy && <> · {e.exportedBy}</>}
          </li>
        ))}
      </ul>
    </section>
  )
}

const accountLabels: Record<AccountKey, () => string> = {
  receivable: m.bookkeeping_account_receivable,
  bank: m.bookkeeping_account_bank,
  unallocated: m.bookkeeping_account_unallocated,
  outputVat: m.bookkeeping_account_output_vat,
  rent: m.bookkeeping_account_rent,
  rentVat: m.bookkeeping_account_rent_vat,
  fee: m.bookkeeping_account_fee,
  reminderFee: m.bookkeeping_account_reminder_fee,
}

const months = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: new Date(Date.UTC(2026, i, 1)).toLocaleString('sv-SE', { month: 'long', timeZone: 'UTC' }),
}))

const validator = Schema.toStandardSchemaV1(UpdateBookkeepingSettingsInput)

function AccountsForm() {
  const canEdit = useCan()({ bookkeeping: ['manage'] })
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(bookkeepingSettingsQuery())
  const [saved, setSaved] = useState(false)
  const save = useFormMutation({
    mutationFn: updateBookkeepingSettingsFn,
    onSuccess: (updated) => {
      queryClient.setQueryData(bookkeepingSettingsQuery().queryKey, updated)
      return queryClient.invalidateQueries({ queryKey: ['bookkeeping', 'preview'] })
    },
  })
  const form = useAppForm({
    defaultValues: {
      financialYearStartMonth: String(settings.financialYearStartMonth),
      accounts: Object.fromEntries(
        accountKeys.map((key) => [key, settings.accounts[key].number]),
      ) as Record<AccountKey, string>,
    },
    validators: { onSubmit: validator },
    listeners: { onChange: () => setSaved(false) },
    onSubmit: async ({ value }) => {
      await save.mutateAsync({ data: value })
      setSaved(true)
    },
  })

  return (
    <section className="grid gap-3 border-t pt-6">
      <div className="grid gap-1">
        <h2 className="font-medium text-lg">{m.bookkeeping_accounts_title()}</h2>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {m.bookkeeping_accounts_description()}
        </p>
      </div>
      <SubmissionForm form={form} disabled={!canEdit} method="post">
        <fieldset disabled={!canEdit} className="grid gap-4 rounded-xl border bg-card p-4 md:p-5">
          <form.AppField name="financialYearStartMonth">
            {(field) => (
              <field.SelectField
                label={m.bookkeeping_year_start()}
                options={months}
                disabled={!canEdit}
              />
            )}
          </form.AppField>
          <div className="grid gap-4 sm:grid-cols-2">
            {accountKeys.map((key) => (
              <form.AppField key={key} name={`accounts.${key}`}>
                {(field) => (
                  <field.TextField
                    label={accountLabels[key]()}
                    inputMode="numeric"
                    hint={settings.defaults[key].name}
                  />
                )}
              </form.AppField>
            ))}
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <form.AppForm>
                <form.SubmitButton>{m.common_save_changes()}</form.SubmitButton>
              </form.AppForm>
              {saved && (
                <span className="text-muted-foreground text-sm">{m.bookkeeping_saved()}</span>
              )}
            </div>
          )}
        </fieldset>
      </SubmissionForm>
    </section>
  )
}
