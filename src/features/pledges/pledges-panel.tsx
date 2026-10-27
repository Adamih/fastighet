import { Link } from '@tanstack/react-router'
import { Landmark, Plus } from 'lucide-react'
import { Panel } from '#/components/detail'
import { Button } from '#/components/ui/button'
import { stockholmDate } from '#/lib/dates'
import { m } from '#/paraglide/messages'
import { useRegisterPledgeDrawer, useReleasePledgeDrawer } from './pledge-form'
import type { PledgeView } from './program'

/** "Underrättad 2024-03-01 · ref. L-2 · 556000-9999" */
const pledgeMeta = (p: PledgeView) =>
  [
    m.pledge_notified({ date: p.notifiedOn }),
    p.reference && m.pledge_ref({ reference: p.reference }),
    p.creditorOrganizationNumber,
  ]
    .filter(Boolean)
    .join(' · ')

/** The confirmation to the lender: whether it was sent, and a link to print or send it. */
function ConfirmationLink({
  ownershipId,
  pledge,
  kind,
}: {
  ownershipId: string
  pledge: PledgeView
  kind: 'registered' | 'released'
}) {
  const sentAt = kind === 'registered' ? pledge.confirmedAt : pledge.releaseConfirmedAt
  return (
    <span className="text-muted-foreground">
      <Link
        to="/ownerships/$ownershipId/pledges/$pledgeId"
        params={{ ownershipId, pledgeId: pledge.id }}
        search={{ kind }}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        {kind === 'registered' ? m.pledge_confirmation() : m.pledge_confirmation_release()}
      </Link>
      {' · '}
      {sentAt ? (
        m.pledge_confirmation_sent({ date: stockholmDate(sentAt) })
      ) : (
        <span className="text-amber-700 dark:text-amber-300">
          {m.pledge_confirmation_not_sent()}
        </span>
      )}
    </span>
  )
}

function ActivePledge({
  ownershipId,
  pledge,
  canManage,
}: {
  ownershipId: string
  pledge: PledgeView
  canManage: boolean
}) {
  const release = useReleasePledgeDrawer(pledge)
  return (
    <li className="flex items-start gap-3 border-t py-2.5 text-[13px] first:border-t-0 first:pt-0">
      <span className="w-5 shrink-0 font-semibold tabular-nums">
        {m.pledge_priority({ priority: String(pledge.priority) })}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-semibold">{pledge.creditorName}</span>
        <span className="text-muted-foreground">{pledgeMeta(pledge)}</span>
        {pledge.note && <span className="text-muted-foreground">{pledge.note}</span>}
        <ConfirmationLink ownershipId={ownershipId} pledge={pledge} kind="registered" />
      </span>
      {canManage && (
        <Button variant="outline" className="h-11 shrink-0 sm:h-8" onClick={release.open}>
          {m.pledge_release()}
        </Button>
      )}
    </li>
  )
}

/**
 * The bostadsrätt's pledges in the apartment register: those in force in priority order, then
 * released ones as history.
 */
export function PledgesPanel({
  ownership,
  canManage,
}: {
  ownership: { id: string; endDate: string | null; pledges: readonly PledgeView[] }
  canManage: boolean
}) {
  const register = useRegisterPledgeDrawer(ownership)
  const active = ownership.pledges.filter((p) => p.active)
  const released = ownership.pledges.filter((p) => !p.active)
  return (
    <Panel
      title={m.pledge_panel_title()}
      action={
        canManage && (
          <Button variant="outline" className="h-11 sm:h-8" onClick={register.open}>
            <Plus aria-hidden="true" />
            {m.pledge_register()}
          </Button>
        )
      }
    >
      {active.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Landmark aria-hidden="true" className="size-4" />
          {m.pledge_none()}
        </p>
      ) : (
        <ol>
          {active.map((p) => (
            <ActivePledge key={p.id} ownershipId={ownership.id} pledge={p} canManage={canManage} />
          ))}
        </ol>
      )}
      {released.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">
            {m.pledge_history()} ({released.length})
          </summary>
          <ul className="mt-2 grid gap-2">
            {released.map((p) => (
              <li key={p.id} className="grid gap-0.5">
                <span className="font-medium">{p.creditorName}</span>
                <span className="text-muted-foreground">
                  {[pledgeMeta(p), p.releasedOn && m.pledge_released({ date: p.releasedOn })]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {p.releaseNote && <span className="text-muted-foreground">{p.releaseNote}</span>}
                <ConfirmationLink ownershipId={ownership.id} pledge={p} kind="released" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  )
}
