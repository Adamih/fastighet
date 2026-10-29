import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { chargeKindLabels } from '#/features/agreements/charges-panel'
import { LeaseStatusBadge } from '#/features/leases/components'
import { formatShortDate } from '#/features/leases/overview'
import { agreementKindLabels, partyRoleLabels } from '#/features/portal/agreement-labels'
import { portalAgreementQuery } from '#/features/portal/portal-functions'
import { unitKindLabels } from '#/features/properties/unit-kinds'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/portal/_portal/avtal/$agreementId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(portalAgreementQuery(params.agreementId)),
  component: PortalAgreementPage,
})

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  )
}

const per = (interval: 'monthly' | 'yearly' | 'once') =>
  interval === 'yearly' ? m.common_per_year() : interval === 'monthly' ? m.common_per_month() : ''

function PortalAgreementPage() {
  const { agreementId } = Route.useParams()
  const { data: a } = useSuspenseQuery(portalAgreementQuery(agreementId))
  const chargeLabel = (c: { kind: keyof typeof chargeKindLabels; description: string | null }) =>
    c.description ? `${chargeKindLabels[c.kind]()}: ${c.description}` : chargeKindLabels[c.kind]()

  return (
    <div className="grid gap-4">
      <Link
        to="/portal/avtal"
        className="inline-flex h-11 items-center gap-1 text-muted-foreground text-sm sm:h-auto"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {m.portal_nav_agreements()}
      </Link>
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="font-bold text-2xl tracking-tight">
          {agreementKindLabels[a.kind]()} {a.number}
        </h1>
        <LeaseStatusBadge status={a.status} />
      </header>

      <Section title={m.portal_agreement_units()}>
        {a.units.map((u) => (
          <Row
            key={`${u.designation}-${u.label}`}
            label={unitKindLabels[u.kind]}
            value={`${u.address ?? u.designation} · ${u.label}`}
          />
        ))}
      </Section>

      <Section title={a.kind === 'lease' ? m.portal_agreement_rent() : m.portal_agreement_fee()}>
        {a.charges.map((c) => (
          <Row
            key={c.id}
            label={chargeLabel(c)}
            value={`${formatSek(c.amountOre)} ${per(c.interval)}${c.vat ? ` ${m.common_excl_vat()}` : ''}`}
          />
        ))}
        {a.upcoming.length > 0 && (
          <div className="grid gap-1 border-t pt-2">
            <span className="font-medium text-sm">{m.portal_agreement_upcoming()}</span>
            {a.upcoming.map((c) => (
              <Row
                key={c.id}
                label={`${chargeLabel(c)} ${m.common_from_date({ date: formatShortDate(c.fromDate) })}`}
                value={`${formatSek(c.amountOre)} ${per(c.interval)}`}
              />
            ))}
          </div>
        )}
        {a.indexClause && (
          <p className="border-t pt-2 text-muted-foreground text-xs">
            {m.portal_agreement_index({
              share: a.indexClause.sharePercent,
              base: a.indexClause.baseMonth,
            })}
          </p>
        )}
      </Section>

      <Section
        title={a.kind === 'lease' ? m.portal_agreement_tenants() : m.portal_agreement_owners()}
      >
        {a.parties.map((p) => (
          <Row
            key={p.id}
            label={p.name}
            value={[
              partyRoleLabels[p.role](),
              p.sharePercent !== null && a.kind === 'tenant_ownership'
                ? `${p.sharePercent} %`
                : null,
              p.receivesInvoices ? m.portal_agreement_gets_invoices() : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </Section>

      <Section title={m.portal_agreement_terms()}>
        <Row label={m.portal_agreement_start()} value={formatShortDate(a.startDate)} />
        {a.endDate && <Row label={m.portal_agreement_end()} value={formatShortDate(a.endDate)} />}
        {a.kind === 'lease' && (
          <>
            {a.terms.termEndDate && (
              <Row
                label={m.portal_agreement_term_end()}
                value={formatShortDate(a.terms.termEndDate)}
              />
            )}
            {a.terms.noticePeriodMonths > 0 && (
              <Row
                label={m.portal_agreement_notice()}
                value={m.portal_agreement_months({ count: a.terms.noticePeriodMonths })}
              />
            )}
            {a.terms.noticeDate && (
              <Row
                label={m.portal_agreement_terminated()}
                value={formatShortDate(a.terms.noticeDate)}
              />
            )}
          </>
        )}
        <Row
          label={m.portal_agreement_invoiced()}
          value={
            a.invoiceInterval === 'monthly'
              ? m.portal_interval_monthly()
              : m.portal_interval_quarterly()
          }
        />
      </Section>
    </div>
  )
}
