import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRightLeft, Banknote, Mail, Pencil, Phone } from 'lucide-react'
import {
  DetailColumns,
  DetailHeader,
  FactList,
  Panel,
  PanelRow,
  StatRow,
} from '#/components/detail'
import { InitialsAvatar } from '#/components/initials-avatar'
import { StatCard } from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useChangeBaseChargeDrawer } from '#/features/agreements/change-charge-form'
import { ChargesPanel } from '#/features/agreements/charges-panel'
import { useAddOneOffDrawer } from '#/features/agreements/one-off-form'
import { useCan } from '#/features/auth/use-can'
import { InvoiceStatusBadge } from '#/features/invoicing/components'
import { owedOrTotal } from '#/features/invoicing/credit'
import { invoicesQuery } from '#/features/invoicing/functions'
import { periodLabel } from '#/features/invoicing/rules'
import { LeaseStatusBadge } from '#/features/leases/components'
import { invoiceIntervalLabels } from '#/features/leases/options'
import { unitSummary } from '#/features/leases/overview'
import { ownershipQuery } from '#/features/ownerships/functions'
import { ownershipStatusLabels } from '#/features/ownerships/labels'
import { useEditOwnershipDrawer } from '#/features/ownerships/ownership-form'
import { formatShareRatio } from '#/features/ownerships/rules'
import { useTransferOwnershipDrawer } from '#/features/ownerships/transfer-form'
import { stockholmDate } from '#/lib/dates'
import { formatSekShort } from '#/lib/money'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/ownerships/$ownershipId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(ownershipQuery(params.ownershipId)),
  component: OwnershipPage,
})

function OwnershipPage() {
  const { ownershipId } = Route.useParams()
  const { data: ownership } = useSuspenseQuery(ownershipQuery(ownershipId))
  const can = useCan()
  const canManage = can({ lease: ['manage'], tenant: ['read'], property: ['read'] })
  const canReadInvoices = can({ invoice: ['read'] })
  const invoices = useQuery({
    ...invoicesQuery({ filter: 'all', agreementId: ownership.id }),
    enabled: canReadInvoices,
  })
  const edit = useEditOwnershipDrawer(ownership)
  const transfer = useTransferOwnershipDrawer(ownership)
  const changeFee = useChangeBaseChargeDrawer(ownership)
  // Member fees are outside VAT, so one-off amounts default to without.
  const addOneOff = useAddOneOffDrawer({ id: ownership.id, vat: false })
  const today = stockholmDate(Date.now())
  const units = unitSummary(ownership.units)
  const title = m.ownership_number({ number: ownership.number })

  return (
    <div className="grid gap-6 md:gap-7">
      <DetailHeader
        back={{ label: m.nav_ownerships(), to: '/ownerships' }}
        crumb={title}
        title={ownership.ownerNames}
        badge={
          <LeaseStatusBadge
            status={ownership.status}
            label={ownershipStatusLabels[ownership.status]}
          />
        }
        meta={[title, units.designations, units.labels.join(', ')].filter(Boolean).join(' · ')}
        actions={
          canManage && (
            <>
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={edit.open}>
                <Pencil aria-hidden="true" />
                {m.ownership_edit()}
              </Button>
              {!ownership.endDate && (
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={changeFee.open}>
                  <Banknote aria-hidden="true" />
                  {changeFee.label}
                </Button>
              )}
              {!ownership.endDate && (
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={transfer.open}>
                  <ArrowRightLeft aria-hidden="true" />
                  {m.ownership_transfer()}
                </Button>
              )}
            </>
          )
        }
      />

      {changeFee.notice && (
        <p className="text-[13px] text-emerald-700 dark:text-emerald-300">{changeFee.notice}</p>
      )}
      <StatRow>
        <StatCard
          label={m.ownership_fee_label()}
          hint={invoiceIntervalLabels[ownership.invoiceInterval]}
        >
          {formatSekShort(ownership.rentOre)}
        </StatCard>
        <StatCard label={m.ownership_share_ratio_label()}>
          {ownership.shareRatio === null ? '–' : formatShareRatio(ownership.shareRatio)}
        </StatCard>
        <StatCard label={m.ownership_start()} hint={ownership.endDate && m.ownership_end()}>
          {ownership.endDate
            ? `${ownership.startDate} – ${ownership.endDate}`
            : ownership.startDate}
        </StatCard>
      </StatRow>

      {(ownership.previous || ownership.next) && (
        <nav aria-label={m.ownership_transfer()} className="grid gap-1.5 text-[13px]">
          {ownership.previous && (
            <Link
              to="/ownerships/$ownershipId"
              params={{ ownershipId: ownership.previous.id }}
              className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 font-medium underline-offset-4 hover:underline"
            >
              <ArrowRightLeft aria-hidden="true" className="size-4 text-muted-foreground" />
              {m.ownership_from({
                label: m.ownership_number({ number: ownership.previous.number }),
              })}
            </Link>
          )}
          {ownership.next && (
            <Link
              to="/ownerships/$ownershipId"
              params={{ ownershipId: ownership.next.id }}
              className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 font-medium underline-offset-4 hover:underline"
            >
              <ArrowRightLeft aria-hidden="true" className="size-4 text-muted-foreground" />
              {m.ownership_to({
                label: m.ownership_number({ number: ownership.next.number }),
                date: ownership.next.startDate,
              })}
            </Link>
          )}
        </nav>
      )}

      <DetailColumns
        main={
          canReadInvoices && (
            <Panel title={m.nav_invoices()}>
              {!invoices.data || invoices.data.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{m.invoice_list_empty()}</p>
              ) : (
                <div>
                  {invoices.data.map((i) => (
                    <PanelRow key={i.id}>
                      <Link
                        to="/invoices/$invoiceId"
                        params={{ invoiceId: i.id }}
                        className="min-w-0 truncate underline-offset-4 hover:underline"
                      >
                        <span className="font-semibold">#{i.number}</span>{' '}
                        <span className="text-muted-foreground">
                          · {periodLabel({ start: i.periodStart, end: i.periodEnd })}
                        </span>
                      </Link>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="font-semibold tabular-nums">
                          {formatSekShort(owedOrTotal(i))}
                        </span>
                        <InvoiceStatusBadge status={i.status} />
                      </span>
                    </PanelRow>
                  ))}
                </div>
              )}
            </Panel>
          )
        }
        side={
          <>
            <Panel title={m.ownership_owners()}>
              <ul className="grid gap-4">
                {ownership.owners.map((owner) => (
                  <li key={owner.id} className="grid gap-2.5">
                    <div className="flex items-center gap-3">
                      <InitialsAvatar name={owner.name} square={owner.kind === 'company'} />
                      <div className="grid min-w-0 gap-0.5 text-[13px]">
                        <Link
                          to="/tenants/$tenantId"
                          params={{ tenantId: owner.id }}
                          className="truncate font-semibold underline-offset-4 hover:underline"
                        >
                          {owner.name}
                        </Link>
                        <span className="text-muted-foreground">
                          {[
                            m.ownership_owner_share({ percent: owner.sharePercent }),
                            ownership.owners.length > 1 && owner.receivesInvoices
                              ? m.lease_receives_invoices()
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                    </div>
                    {owner.contact && (owner.contact.email || owner.contact.phone) && (
                      <div className="grid gap-1.5 text-[13px]">
                        {owner.contact.email && (
                          <a
                            href={`mailto:${owner.contact.email}`}
                            className="flex min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground"
                          >
                            <Mail aria-hidden="true" className="size-3.5 shrink-0" />
                            <span className="truncate">{owner.contact.email}</span>
                          </a>
                        )}
                        {owner.contact.phone && (
                          <a
                            href={`tel:${owner.contact.phone.replace(/[^\d+]/g, '')}`}
                            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                          >
                            <Phone aria-hidden="true" className="size-3.5 shrink-0" />
                            {owner.contact.phone}
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
            <ChargesPanel
              agreement={ownership}
              units={ownership.unitRows}
              today={today}
              canManage={canManage}
              onAddOneOff={addOneOff.open}
            />
            <Panel title={m.ownership_details()}>
              <FactList
                facts={[
                  [m.ownership_start(), ownership.startDate],
                  ...(ownership.endDate ? ([[m.ownership_end(), ownership.endDate]] as const) : []),
                  [m.ownership_granted_on(), ownership.grantedOn ?? '–'],
                  [
                    m.ownership_deposit_label(),
                    ownership.depositOre === null ? '–' : formatSekShort(ownership.depositOre),
                  ],
                  [
                    m.lease_form_invoice_interval(),
                    invoiceIntervalLabels[ownership.invoiceInterval],
                  ],
                  [
                    m.ownership_units(),
                    <span key="units" className="grid">
                      {ownership.units.map((u) => (
                        <Link
                          key={u.id}
                          to="/units/$unitId"
                          params={{ unitId: u.id }}
                          className="underline-offset-4 hover:underline"
                        >
                          {u.designation} · {u.label}
                        </Link>
                      ))}
                    </span>,
                  ],
                ]}
              />
            </Panel>
          </>
        }
      />
    </div>
  )
}
