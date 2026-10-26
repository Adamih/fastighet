import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Banknote, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Panel } from '#/components/detail'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { m } from '#/paraglide/messages'
import { refundInvoiceFn, undoInvoiceRefundFn } from './functions'

/**
 * What an avi was overpaid by (a credit note after payment) and paying it back. Shown on the
 * avi page when something is or was to be paid back.
 */
export function RefundPanel({
  invoice,
  canRefund,
}: {
  invoice: { id: string; refundDueOre: number; refundedOre: number }
  canRefund: boolean
}) {
  const queryClient = useQueryClient()
  const today = stockholmDate(Date.now())
  const [refundedOn, setRefundedOn] = useState(today)
  const onSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: ['invoices'] })
    await queryClient.invalidateQueries({ queryKey: ['payments'] })
  }
  const refund = useMutation({ mutationFn: refundInvoiceFn, onSuccess })
  const undo = useMutation({ mutationFn: undoInvoiceRefundFn, onSuccess })
  const error = refund.error ?? undo.error

  return (
    <Panel title={m.credit_note_refund()}>
      <div className="grid gap-3 text-[13px]">
        {invoice.refundedOre > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
              <Banknote aria-hidden="true" className="size-4" />
              {m.refund_refunded_amount({ amount: formatSekShort(invoice.refundedOre) })}
            </span>
            {canRefund && (
              <Button
                variant="ghost"
                className="h-11 sm:h-8"
                disabled={undo.isPending}
                onClick={() => undo.mutate({ data: { invoiceId: invoice.id } })}
              >
                <Undo2 aria-hidden="true" />
                {m.credit_note_undo_refund()}
              </Button>
            )}
          </div>
        )}
        {invoice.refundDueOre > 0 && (
          <>
            <span className="font-medium text-amber-700 dark:text-amber-300">
              {m.refund_due_amount({ amount: formatSekShort(invoice.refundDueOre) })}
            </span>
            {canRefund && (
              <div className="grid gap-2">
                <Label htmlFor="refundedOn">{m.credit_note_refund_date()}</Label>
                <Input
                  id="refundedOn"
                  type="date"
                  value={refundedOn}
                  max={today}
                  className="h-11 sm:h-9"
                  onChange={(e) => setRefundedOn(e.target.value)}
                />
                <Button
                  className="h-11 w-full sm:h-10"
                  disabled={refund.isPending}
                  onClick={() => refund.mutate({ data: { invoiceId: invoice.id, refundedOn } })}
                >
                  {m.credit_note_register_refund()}
                </Button>
              </div>
            )}
          </>
        )}
        {error && <p className="text-destructive text-sm">{error.message}</p>}
      </div>
    </Panel>
  )
}
