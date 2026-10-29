import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { formatShortDate } from '#/features/leases/overview'
import type { PortalApartment } from '#/features/portal/apartment-program'
import { portalApartmentsQuery, portalExtractFn } from '#/features/portal/portal-functions'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

// A BRF member's bostadsrätt: the apartment register's entry, its pledges, and an extract.
export const Route = createFileRoute('/portal/_portal/lagenhet')({
  beforeLoad: ({ context }) => {
    if (context.portal.company?.kind !== 'brf') throw redirect({ to: '/portal' })
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(portalApartmentsQuery()),
  component: ApartmentPage,
})

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-4 print:border-0 print:p-0">
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

function ApartmentPage() {
  const { data: apartments } = useSuspenseQuery(portalApartmentsQuery())
  return (
    <div className="grid gap-5">
      <h1 className="font-bold text-2xl tracking-tight md:text-3xl print:hidden">
        {m.portal_nav_apartment()}
      </h1>
      {apartments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{m.portal_apartment_none()}</p>
      ) : (
        apartments.map((a) => <Apartment key={a.ownership.id} entry={a} />)
      )}
    </div>
  )
}

function Apartment({ entry }: { entry: PortalApartment }) {
  const [showExtract, setShowExtract] = useState(false)
  const apartment = entry.apartment
  const active = entry.pledges.filter((p) => p.active)
  const released = entry.pledges.filter((p) => !p.active)
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 print:hidden">
        <Section
          title={
            apartment
              ? `${apartment.streetAddress ?? apartment.designation} · ${apartment.label}`
              : m.portal_nav_apartment()
          }
        >
          {apartment && (
            <>
              <Row label={m.portal_apartment_designation()} value={apartment.designation} />
              {apartment.areaSqm !== null && (
                <Row label={m.portal_apartment_area()} value={`${apartment.areaSqm} m²`} />
              )}
              {apartment.rooms !== null && (
                <Row label={m.portal_apartment_rooms()} value={apartment.rooms} />
              )}
              {apartment.shareRatio !== null && (
                <Row
                  label={m.portal_apartment_share()}
                  value={String(apartment.shareRatio).replace('.', ',')}
                />
              )}
              {apartment.depositOre !== null && (
                <Row label={m.portal_apartment_deposit()} value={formatSek(apartment.depositOre)} />
              )}
              {apartment.grantedOn && (
                <Row
                  label={m.portal_apartment_granted()}
                  value={formatShortDate(apartment.grantedOn)}
                />
              )}
            </>
          )}
          {entry.otherUnits.map((u) => (
            <Row key={u.label} label={m.portal_apartment_also()} value={u.label} />
          ))}
          <div className="grid gap-1 border-t pt-2">
            {entry.holders.map((h) => (
              <Row key={h.name} label={h.name} value={`${h.sharePercent} %`} />
            ))}
          </div>
        </Section>
        <Section title={m.portal_pledges()}>
          {active.length === 0 ? (
            <p className="text-muted-foreground text-sm">{m.portal_pledges_none()}</p>
          ) : (
            active.map((p) => (
              <Row
                key={p.id}
                label={`${p.priority}. ${p.creditorName}`}
                value={m.portal_pledge_notified({ date: formatShortDate(p.notifiedOn) })}
              />
            ))
          )}
          {released.length > 0 && (
            <div className="grid gap-1 border-t pt-2 text-muted-foreground">
              {released.map((p) => (
                <Row
                  key={p.id}
                  label={p.creditorName}
                  value={m.portal_pledge_released({ date: formatShortDate(p.releasedOn ?? '') })}
                />
              ))}
            </div>
          )}
        </Section>
        {!showExtract && (
          <Button
            variant="outline"
            className="h-11 w-full sm:h-9 sm:w-auto sm:justify-self-start"
            onClick={() => setShowExtract(true)}
          >
            {m.portal_extract_show()}
          </Button>
        )}
      </div>
      {showExtract && <Extract ownershipId={entry.ownership.id} />}
    </div>
  )
}

/** Fetched only when asked for: producing an extract is recorded in the audit log. */
function Extract({ ownershipId }: { ownershipId: string }) {
  const extract = useQuery({
    queryKey: ['portal', 'extract', ownershipId],
    queryFn: () => portalExtractFn({ data: { ownershipId } }),
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (extract.error) {
    return (
      <QueryError
        error={extract.error}
        pending={extract.isFetching}
        retry={() => extract.refetch()}
      />
    )
  }
  if (!extract.data) return null
  const e = extract.data
  return (
    <Section title={m.portal_extract_title()}>
      <p className="text-sm">
        {m.portal_extract_intro({
          association: e.association.name,
          number: e.association.organizationNumber ?? '–',
          date: e.onDate,
        })}
      </p>
      {e.apartment && (
        <Row
          label={m.portal_apartment_designation()}
          value={`${e.apartment.designation} · ${e.apartment.label}`}
        />
      )}
      {e.holders.map((h) => (
        <Row
          key={h.name}
          label={m.portal_extract_holder()}
          value={`${h.name}, ${h.sharePercent} %`}
        />
      ))}
      <div className="grid gap-1 border-t pt-2">
        <span className="font-medium text-sm">{m.portal_pledges()}</span>
        {e.pledges.length === 0 ? (
          <p className="text-muted-foreground text-sm">{m.portal_pledges_none()}</p>
        ) : (
          e.pledges.map((p) => (
            <Row
              key={`${p.priority}-${p.creditorName}`}
              label={`${p.priority}. ${p.creditorName}${p.creditorOrganizationNumber ? ` (${p.creditorOrganizationNumber})` : ''}`}
              value={m.portal_pledge_notified({ date: p.notifiedOn })}
            />
          ))
        )}
      </div>
      <Button
        variant="outline"
        className="h-11 w-full sm:h-9 sm:w-auto print:hidden"
        onClick={() => window.print()}
      >
        <Printer aria-hidden="true" />
        {m.portal_extract_print()}
      </Button>
    </Section>
  )
}
