import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Panel, PanelRow } from '#/components/detail'
import { Button } from '#/components/ui/button'
import { formatSekShort } from '#/lib/money'
import { m } from '#/paraglide/messages'
import { isBaseKind } from './charges'
import { removeOneOffChargeFn } from './functions'
import type { AgreementKind, ChargeKind } from './kinds'
import { inForceOn } from './periods'

const kindLabels: Record<ChargeKind, () => string> = {
  rent: m.charges_kind_rent,
  fee: m.charges_kind_fee,
  parking: m.charges_kind_parking,
  storage: m.charges_kind_storage,
  utility: m.charges_kind_utility,
  index: m.charges_kind_index,
  one_off: m.charges_kind_one_off,
  other: m.charges_kind_other,
  reminder_fee: m.charges_kind_reminder_fee,
  pledge_fee: m.charges_kind_pledge_fee,
  transfer_fee: m.charges_kind_transfer_fee,
  late_interest: m.charges_kind_late_interest,
}

interface PanelCharge {
  id: string
  kind: ChargeKind
  unitId: string | null
  description: string | null
  amountOre: number
  interval: 'monthly' | 'yearly' | 'once'
  vat: boolean
  fromDate: string
  toDate: string | null
}

const amountText = (c: PanelCharge) =>
  `${formatSekShort(c.amountOre)}${c.interval === 'monthly' ? ` ${m.common_per_month()}` : c.interval === 'yearly' ? ` ${m.common_per_year()}` : ''}`

const spanText = (c: PanelCharge) =>
  c.toDate
    ? m.charges_span({ from: c.fromDate, to: c.toDate })
    : m.charges_from({ date: c.fromDate })

/**
 * What the agreement bills: the base charge (rent or fee) with its history, add-ons and one-off
 * amounts, which are billed or still to come.
 */
export function ChargesPanel({
  agreement,
  units,
  today,
  canManage,
  onAddOneOff,
}: {
  agreement: {
    kind: AgreementKind
    charges: readonly PanelCharge[]
    billedChargeIds: readonly string[]
  }
  units: readonly { unitId: string; label: string }[]
  today: string
  canManage: boolean
  onAddOneOff: () => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: removeOneOffChargeFn,
    onSuccess: async () => {
      for (const queryKey of [['leases'], ['ownerships'], ['invoices']]) {
        await queryClient.invalidateQueries({ queryKey })
      }
    },
  })
  const base = agreement.charges.filter((c) => isBaseKind(c.kind))
  const current = base.filter((c) => inForceOn(c, today) || c.fromDate > today)
  const past = base.filter((c) => !current.includes(c)).reverse()
  const addOns = agreement.charges.filter(
    (c) => !isBaseKind(c.kind) && c.interval !== 'once' && (c.toDate === null || c.toDate >= today),
  )
  const oneOffs = agreement.charges.filter((c) => c.interval === 'once').reverse()
  const billed = new Set(agreement.billedChargeIds)
  const unitLabel = (id: string | null) => units.find((u) => u.unitId === id)?.label

  return (
    <Panel
      title={agreement.kind === 'tenant_ownership' ? m.charges_panel_fee() : m.charges_panel_rent()}
      action={
        canManage && (
          <Button variant="ghost" className="h-11 sm:h-8" onClick={onAddOneOff}>
            <Plus aria-hidden="true" />
            {m.charges_add_one_off()}
          </Button>
        )
      }
    >
      <div className="grid gap-4 text-[13px]">
        <div>
          {current.map((c) => (
            <PanelRow key={c.id}>
              <span className="grid min-w-0 gap-0.5">
                <span className="font-semibold">
                  {kindLabels[c.kind]()}
                  {c.fromDate > today && (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · {m.charges_upcoming()}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">{spanText(c)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{amountText(c)}</span>
            </PanelRow>
          ))}
          {past.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer py-1.5 text-muted-foreground">
                {m.charges_history()}
              </summary>
              {past.map((c) => (
                <PanelRow key={c.id}>
                  <span className="text-muted-foreground">{spanText(c)}</span>
                  <span className="shrink-0 tabular-nums">{amountText(c)}</span>
                </PanelRow>
              ))}
            </details>
          )}
        </div>
        {addOns.length > 0 && (
          <div className="grid gap-1">
            <h3 className="font-medium text-muted-foreground">{m.charges_add_ons()}</h3>
            {addOns.map((c) => (
              <PanelRow key={c.id}>
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-semibold">
                    {[kindLabels[c.kind](), c.description ?? unitLabel(c.unitId)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="text-muted-foreground">{spanText(c)}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{amountText(c)}</span>
              </PanelRow>
            ))}
          </div>
        )}
        {oneOffs.length > 0 && (
          <div className="grid gap-1">
            <h3 className="font-medium text-muted-foreground">{m.charges_one_offs()}</h3>
            {oneOffs.map((c) => (
              <PanelRow key={c.id}>
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-semibold">{c.description}</span>
                  <span className="text-muted-foreground">
                    {billed.has(c.id)
                      ? m.charges_one_off_billed()
                      : m.charges_one_off_pending({ date: c.fromDate })}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-semibold tabular-nums">{formatSekShort(c.amountOre)}</span>
                  {canManage && !billed.has(c.id) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-8"
                      disabled={remove.isPending}
                      aria-label={m.charges_remove({ description: c.description ?? '' })}
                      onClick={() => remove.mutate({ data: { chargeId: c.id } })}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </span>
              </PanelRow>
            ))}
          </div>
        )}
        {addOns.length === 0 && oneOffs.length === 0 && (
          <p className="text-muted-foreground">{m.charges_none()}</p>
        )}
        {remove.error && <p className="text-destructive">{remove.error.message}</p>}
      </div>
    </Panel>
  )
}
