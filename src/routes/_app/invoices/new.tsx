import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { createInvoiceRunFn, invoiceRunPreviewQuery } from '#/features/invoicing/functions'
import { isInvoiceMonth, periodLabel } from '#/features/invoicing/rules'
import { addMonths, stockholmDate } from '#/lib/dates'
import { formatSek } from '#/lib/money'

export const Route = createFileRoute('/_app/invoices/new')({ component: NewInvoiceRunPage })

/** Rent is invoiced in advance, so the natural default is next month. */
const nextMonth = () => addMonths(`${stockholmDate(Date.now()).slice(0, 7)}-01`, 1).slice(0, 7)

type RunResult = Awaited<ReturnType<typeof createInvoiceRunFn>>

function NewInvoiceRunPage() {
  const [month, setMonth] = useState(nextMonth)
  const [send, setSend] = useState(true)
  const [result, setResult] = useState<RunResult | null>(null)
  const valid = isInvoiceMonth(month)
  const preview = useQuery({ ...invoiceRunPreviewQuery(month), enabled: valid })
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

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link to="/invoices" className="text-muted-foreground text-sm hover:underline">
          ← Avier
        </Link>
        <h1 className="font-semibold text-2xl">Skapa avier</h1>
        <p className="text-muted-foreground">
          Välj vilken månad hyran avser. Kvartalsaviserade avtal tas med i januari, april, juli och
          oktober. Avtal som redan är aviserade för perioden hoppas över, så du kan köra om.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="grid gap-1.5">
          <Label htmlFor="month">Hyresmånad</Label>
          <Input
            id="month"
            type="month"
            value={month}
            className="w-48"
            onChange={(e) => {
              setMonth(e.target.value)
              setResult(null)
            }}
          />
        </div>
        <div className="flex items-center gap-3 pb-2">
          <Switch id="send" checked={send} onCheckedChange={setSend} />
          <Label htmlFor="send">Skicka e-post till hyresgäster med e-postadress</Label>
        </div>
      </div>

      {result ? (
        <section className="grid gap-2 rounded-lg border p-6">
          <h2 className="font-medium text-lg">Klart</h2>
          <ul className="grid gap-1 text-sm">
            <li>{result.created} avier skapade</li>
            {result.skipped > 0 && <li>{result.skipped} redan aviserade, hoppades över</li>}
            {send && <li>{result.sent} skickade med e-post</li>}
            {result.withoutEmail > 0 && (
              <li>{result.withoutEmail} hyresgäster saknar e-post. Skriv ut deras avier.</li>
            )}
            {result.failed > 0 && (
              <li className="text-destructive">
                {result.failed} kunde inte skickas. Försök igen från avin.
              </li>
            )}
          </ul>
          <Link to="/invoices" className="underline">
            Visa avier
          </Link>
        </section>
      ) : preview.isPending && valid ? (
        <p className="text-muted-foreground">Räknar…</p>
      ) : preview.error ? (
        <p className="text-destructive text-sm">{preview.error.message}</p>
      ) : preview.data && !preview.data.canInvoice ? (
        <p>
          Ange ert bankgironummer under{' '}
          <Link to="/settings" className="underline">
            Inställningar
          </Link>{' '}
          innan du skapar avier.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">Inga avtal att avisera för {month}.</p>
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Avtal</th>
                <th className="py-2 font-medium">Hyresgäst</th>
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 font-medium">Förfallodag</th>
                <th className="py-2 text-right font-medium">Belopp</th>
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
                    {r.vatOre > 0 && <span className="text-muted-foreground"> inkl. moms</span>}
                  </td>
                  <td className="py-2 pl-4 text-xs">
                    {r.alreadyInvoiced
                      ? 'Redan aviserad'
                      : !r.tenant.email && send
                        ? 'Ingen e-post'
                        : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {create.error && <p className="text-destructive text-sm">{create.error.message}</p>}
          <div className="flex items-center gap-4">
            <Button
              disabled={pending.length === 0 || create.isPending}
              onClick={() => create.mutate({ data: { month, send } })}
            >
              {pending.length === 0 ? 'Allt är redan aviserat' : `Skapa ${pending.length} avier`}
            </Button>
            {pending.length > 0 && (
              <span className="text-sm">
                Totalt <span className="font-medium tabular-nums">{formatSek(pendingTotal)}</span>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
