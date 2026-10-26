import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Panel, PanelRow } from '#/components/detail'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { partyAccountQuery, refundCreditFn, undoCreditRefundFn } from './functions'

/** How many postings the panel lists; the newest come first. */
const SHOWN = 8

/**
 * A tenant's account on their page: what they owe or have to their credit (tillgodo), paying the
 * credit back, and the latest postings with the balance after each.
 */
export function AccountPanel({ partyId, canRefund }: { partyId: string; canRefund: boolean }) {
  const queryClient = useQueryClient()
  const account = useQuery(partyAccountQuery(partyId))
  const today = stockholmDate(Date.now())
  const [refunding, setRefunding] = useState(false)
  const [refundedOn, setRefundedOn] = useState(today)
  const onSuccess = async () => {
    setRefunding(false)
    await queryClient.invalidateQueries({ queryKey: ['invoices'] })
    await queryClient.invalidateQueries({ queryKey: ['payments'] })
  }
  const refund = useMutation({ mutationFn: refundCreditFn, onSuccess })
  const undo = useMutation({ mutationFn: undoCreditRefundFn, onSuccess })
  const error = refund.error ?? undo.error

  if (account.error) {
    return (
      <Panel title={m.account_title()}>
        <QueryError
          error={account.error}
          pending={account.isFetching}
          retry={() => account.refetch()}
        />
      </Panel>
    )
  }
  if (!account.data) return null
  const a = account.data

  return (
    <Panel title={m.account_title()}>
      <div className="grid gap-3 text-[13px]">
        <p
          className={cn(
            'font-semibold text-base tabular-nums',
            a.creditOre > 0 && 'text-emerald-700 dark:text-emerald-300',
          )}
        >
          {a.owedOre > 0
            ? m.account_owed({ amount: formatSekShort(a.owedOre) })
            : a.creditOre > 0
              ? m.account_credit({ amount: formatSekShort(a.creditOre) })
              : m.account_settled()}
        </p>
        {a.owedOre > 0 && a.creditOre > 0 && (
          <p className="text-emerald-700 dark:text-emerald-300">
            {m.account_credit({ amount: formatSekShort(a.creditOre) })}
          </p>
        )}
        {a.creditOre > 0 && <p className="text-muted-foreground">{m.account_credit_hint()}</p>}

        {canRefund && a.creditOre > 0 && !refunding && (
          <div>
            <Button variant="outline" className="h-11 sm:h-8" onClick={() => setRefunding(true)}>
              <Banknote aria-hidden="true" />
              {m.account_refund()}
            </Button>
          </div>
        )}
        {refunding && (
          <div className="grid gap-2 sm:flex sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor={`refund-${partyId}`}>{m.account_refund_date()}</Label>
              <Input
                id={`refund-${partyId}`}
                type="date"
                max={today}
                className="h-11 sm:h-9"
                value={refundedOn}
                onChange={(e) => setRefundedOn(e.target.value)}
              />
            </div>
            <Button
              className="h-11 sm:h-9"
              disabled={refund.isPending}
              onClick={() => refund.mutate({ data: { partyId, refundedOn } })}
            >
              {m.account_refund_confirm({ amount: formatSekShort(a.creditOre) })}
            </Button>
            <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setRefunding(false)}>
              {m.common_cancel()}
            </Button>
          </div>
        )}
        {a.lastRefund && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              {m.account_refunded({
                amount: formatSekShort(a.lastRefund.amountOre),
                date: a.lastRefund.date,
              })}
            </span>
            {canRefund && (
              <Button
                variant="ghost"
                className="h-11 sm:h-8"
                disabled={undo.isPending}
                onClick={() => undo.mutate({ data: { partyId } })}
              >
                <Undo2 aria-hidden="true" />
                {m.account_undo_refund()}
              </Button>
            )}
          </div>
        )}
        {error && <p className="text-destructive">{error.message}</p>}

        {a.history.length > 0 && (
          <div>
            <h3 className="mb-1 font-medium text-muted-foreground">{m.account_history()}</h3>
            {a.history.slice(0, SHOWN).map((h) => (
              <PanelRow key={h.id}>
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate">{h.description}</span>
                  <span className="text-muted-foreground tabular-nums">{h.date}</span>
                </span>
                <span className="grid shrink-0 justify-items-end gap-0.5 tabular-nums">
                  <span className="font-medium">
                    {h.amountOre > 0 ? '+' : '−'}
                    {formatSekShort(Math.abs(h.amountOre))}
                  </span>
                  <span className="text-muted-foreground">
                    {h.balanceOre < 0
                      ? m.account_balance_credit({ amount: formatSekShort(-h.balanceOre) })
                      : m.account_balance_owed({ amount: formatSekShort(h.balanceOre) })}
                  </span>
                </span>
              </PanelRow>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
