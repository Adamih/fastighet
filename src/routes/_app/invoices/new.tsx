import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { desktopTableClass, MobileList, RowMeta, RowTitle } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { useCan } from '#/features/auth/use-can'
import { createInvoiceRunFn, invoiceRunPreviewQuery } from '#/features/invoicing/functions'
import { isInvoiceMonth, periodLabel } from '#/features/invoicing/rules'
import { addMonths, stockholmDate } from '#/lib/dates'
import { formatSek } from '#/lib/money'
import { rich } from '#/lib/rich'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/invoices/new')({ component: NewInvoiceRunPage })

/** Rent is invoiced in advance, so the natural default is next month. */
const nextMonth = () => addMonths(`${stockholmDate(Date.now()).slice(0, 7)}-01`, 1).slice(0, 7)

type RunResult = Awaited<ReturnType<typeof createInvoiceRunFn>>

function NewInvoiceRunPage() {
  const canCreate = useCan()({ invoice: ['manage'], lease: ['read'] })
  const [month, setMonth] = useState(nextMonth)
  const [send, setSend] = useState(true)
  const [result, setResult] = useState<RunResult | null>(null)
  const valid = isInvoiceMonth(month)
  const preview = useQuery({ ...invoiceRunPreviewQuery(month), enabled: valid && canCreate })
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: createInvoiceRunFn,
    onSuccess: async (summary) => {
      setResult(summary)
      await queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })

  const rows = preview.data?.rows ?? []
  const pending = rows.filter((r) => !r.alreadyInvoiced)
  const pendingTotal = pending.reduce((sum, r) => sum + r.totalOre, 0)

  if (!canCreate) return <p>{m.invoice_run_forbidden()}</p>

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link to="/invoices" className="text-muted-foreground text-sm hover:underline">
          ← {m.nav_invoices()}
        </Link>
        <h1 className="font-semibold text-2xl">{m.invoice_run_title()}</h1>
        <p className="text-muted-foreground">{m.invoice_run_intro()}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-6">
        <div className="grid gap-1.5">
          <Label htmlFor="month">{m.invoice_run_month()}</Label>
          <Input
            id="month"
            type="month"
            value={month}
            className="h-11 w-full sm:h-9 sm:w-48"
            onChange={(e) => {
              setMonth(e.target.value)
              setResult(null)
            }}
          />
        </div>
        <div className="flex items-center gap-3 pb-2">
          <Switch id="send" checked={send} onCheckedChange={setSend} />
          <Label htmlFor="send">{m.invoice_run_send()}</Label>
        </div>
      </div>

      {result ? (
        <section className="grid gap-2 rounded-lg border p-4 sm:p-6">
          <h2 className="font-medium text-lg">{m.invoice_run_done()}</h2>
          <ul className="grid gap-1 text-sm">
            <li>{m.invoice_run_created({ count: result.created })}</li>
            {result.skipped > 0 && <li>{m.invoice_run_skipped({ count: result.skipped })}</li>}
            {send && <li>{m.invoice_run_sent({ count: result.sent })}</li>}
            {result.withoutEmail > 0 && (
              <li>{m.invoice_run_without_email({ count: result.withoutEmail })}</li>
            )}
            {result.failed > 0 && (
              <li className="text-destructive">{m.invoice_run_failed({ count: result.failed })}</li>
            )}
          </ul>
          <Link to="/invoices" className="underline">
            {m.invoice_run_view()}
          </Link>
        </section>
      ) : preview.isPending && valid ? (
        <p className="text-muted-foreground">{m.invoice_run_calculating()}</p>
      ) : preview.error ? (
        <p className="text-destructive text-sm">{preview.error.message}</p>
      ) : preview.data && !preview.data.canInvoice ? (
        <p>
          {rich(
            (link) => m.invoice_run_needs_bankgiro({ link }),
            <Link to="/settings" className="underline">
              {m.nav_settings()}
            </Link>,
          )}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">{m.invoice_run_nothing({ month })}</p>
      ) : (
        <>
          <MobileList>
            {rows.map((r) => (
              <li
                key={r.leaseId}
                className={cn('grid gap-1 px-4 py-3', r.alreadyInvoiced && 'text-muted-foreground')}
              >
                <RowTitle
                  end={<span className="font-medium tabular-nums">{formatSek(r.totalOre)}</span>}
                >
                  {r.tenant.name}
                </RowTitle>
                <RowMeta>
                  {m.invoice_run_row_meta({
                    number: r.leaseNumber,
                    period: periodLabel(r.period),
                    due: r.dueDate,
                  })}
                </RowMeta>
                {(r.alreadyInvoiced || r.vatOre > 0 || (!r.tenant.email && send)) && (
                  <span className="text-muted-foreground text-xs">
                    {[
                      r.alreadyInvoiced && m.invoice_run_already(),
                      r.vatOre > 0 && m.common_incl_vat(),
                      !r.alreadyInvoiced && !r.tenant.email && send && m.invoice_run_no_email(),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </MobileList>
          <table className={desktopTableClass}>
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">{m.nav_leases()}</th>
                <th className="py-2 font-medium">{m.lease_form_tenant()}</th>
                <th className="py-2 font-medium">{m.common_period()}</th>
                <th className="py-2 font-medium">{m.invoice_due_date()}</th>
                <th className="py-2 text-right font-medium">{m.common_amount()}</th>
                <th className="py-2 pl-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.leaseId}
                  className={r.alreadyInvoiced ? 'border-b text-muted-foreground' : 'border-b'}
                >
                  <td className="py-2 tabular-nums">{r.leaseNumber}</td>
                  <td className="py-2">{r.tenant.name}</td>
                  <td className="py-2">{periodLabel(r.period)}</td>
                  <td className="py-2 tabular-nums">{r.dueDate}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatSek(r.totalOre)}
                    {r.vatOre > 0 && (
                      <span className="text-muted-foreground"> {m.common_incl_vat()}</span>
                    )}
                  </td>
                  <td className="py-2 pl-4 text-xs">
                    {r.alreadyInvoiced
                      ? m.invoice_run_already()
                      : !r.tenant.email && send
                        ? m.invoice_run_no_email()
                        : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {create.error && <p className="text-destructive text-sm">{create.error.message}</p>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Button
              className="h-11 w-full sm:h-9 sm:w-auto"
              disabled={pending.length === 0 || create.isPending}
              onClick={() => create.mutate({ data: { month, send } })}
            >
              {pending.length === 0
                ? m.invoice_run_all_done()
                : m.invoice_run_create({ count: pending.length })}
            </Button>
            {pending.length > 0 && (
              <span className="text-sm">
                {rich(
                  (amount) => m.invoice_run_total({ amount }),
                  <span className="font-medium tabular-nums">{formatSek(pendingTotal)}</span>,
                )}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
