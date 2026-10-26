import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { DetailHeader } from '#/components/detail'
import { QueryError } from '#/components/query-error'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { ownershipExtractQuery, ownershipQuery } from '#/features/ownerships/functions'
import { formatShareRatio } from '#/features/ownerships/rules'
import { unitKindLabels } from '#/features/properties/unit-kinds'
import { isIsoDate, minDate, stockholmDate } from '#/lib/dates'
import { formatSek } from '#/lib/money'
import { m } from '#/paraglide/messages'

// An extract from the apartment register (lägenhetsförteckningen) for one bostadsrätt, as of a
// day: for the member, their bank or an estate agent. Producing one is audited, so the extract is
// fetched by the component, not a route loader (which hovering a link would run).
export const Route = createFileRoute('/_app/ownerships/$ownershipId_/extract')({
  validateSearch: (search): { date?: string; released?: boolean } => ({
    date: typeof search.date === 'string' && isIsoDate(search.date) ? search.date : undefined,
    released: search.released === true ? true : undefined,
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(ownershipQuery(params.ownershipId)),
  component: ExtractPage,
})

type Extract = Awaited<ReturnType<NonNullable<ReturnType<typeof ownershipExtractQuery>['queryFn']>>>

function ExtractPage() {
  const { ownershipId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: ownership } = useSuspenseQuery(ownershipQuery(ownershipId))
  // The last day the right was held, or today.
  const defaultDate = ownership.endDate
    ? minDate(ownership.endDate, stockholmDate(Date.now()))
    : stockholmDate(Date.now())
  const onDate = search.date ?? defaultDate
  const includeReleased = search.released ?? false
  const extract = useQuery(ownershipExtractQuery({ ownershipId, onDate, includeReleased }))
  const title = m.extract_page_title({ number: ownership.number })

  return (
    <div className="grid gap-6 md:gap-7">
      <DetailHeader
        className="print:hidden"
        back={{
          label: m.ownership_number({ number: ownership.number }),
          to: '/ownerships/$ownershipId',
          params: { ownershipId },
        }}
        crumb={m.extract_open()}
        title={title}
        actions={
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={!extract.data}
            onClick={() => window.print()}
          >
            <Printer aria-hidden="true" />
            {m.extract_print()}
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 print:hidden">
        <div className="grid gap-1.5">
          <Label htmlFor="extract-date">{m.extract_date()}</Label>
          <Input
            id="extract-date"
            type="date"
            className="h-11 w-auto sm:h-9"
            value={onDate}
            max={stockholmDate(Date.now())}
            onChange={(event) => {
              const date = event.target.value
              if (isIsoDate(date)) {
                void navigate({ search: (prev) => ({ ...prev, date }), replace: true })
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2.5">
          <Switch
            id="extract-released"
            checked={includeReleased}
            onCheckedChange={(checked) =>
              navigate({
                search: (prev) => ({ ...prev, released: checked ? true : undefined }),
                replace: true,
              })
            }
          />
          <Label htmlFor="extract-released">{m.extract_show_released()}</Label>
        </div>
      </div>
      {extract.error ? (
        <QueryError
          error={extract.error}
          pending={extract.isFetching}
          retry={() => extract.refetch()}
        />
      ) : extract.data ? (
        <ExtractDocument extract={extract.data} />
      ) : (
        <p className="text-muted-foreground text-sm">{m.common_loading()}</p>
      )}
    </div>
  )
}

function Facts({ facts }: { facts: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="grid gap-2.5 break-inside-avoid">
    <h2 className="font-semibold text-base">{title}</h2>
    {children}
  </section>
)

function ExtractDocument({ extract }: { extract: Extract }) {
  const a = extract.apartment
  const missing = m.extract_missing()
  const address = a && [a.streetAddress, [a.postalCode, a.city].filter(Boolean).join(' ')]
  return (
    <article className="mx-auto grid w-full max-w-3xl gap-7 rounded-lg border bg-card p-4 shadow-sm sm:p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
      <header className="grid gap-2">
        <h1 className="font-semibold text-2xl">{m.extract_title()}</h1>
        <p className="text-muted-foreground text-sm">{m.extract_as_of({ date: extract.onDate })}</p>
      </header>

      <Section title={m.extract_association()}>
        <Facts
          facts={[
            [m.extract_association(), extract.association.name],
            [m.extract_org_number(), extract.association.organizationNumber ?? missing],
            [
              m.extract_ownership(),
              m.extract_ownership_value({
                number: extract.ownership.number,
                date: extract.ownership.startDate,
              }),
            ],
          ]}
        />
      </Section>

      {a && (
        <Section title={m.extract_apartment()}>
          <Facts
            facts={[
              [m.extract_apartment_number(), a.label],
              [m.extract_property(), a.designation],
              [m.extract_address(), address?.filter(Boolean).join(', ') || missing],
              [
                m.extract_area(),
                a.areaSqm === null ? missing : m.extract_area_value({ area: a.areaSqm }),
              ],
              [m.extract_rooms(), a.rooms === null ? missing : String(a.rooms)],
              [
                m.extract_share_ratio(),
                a.shareRatio === null ? missing : formatShareRatio(a.shareRatio),
              ],
              [m.extract_deposit(), a.depositOre === null ? missing : formatSek(a.depositOre)],
              [m.extract_granted_on(), a.grantedOn ?? missing],
              ...(extract.otherUnits.length > 0
                ? ([
                    [
                      m.extract_other_units(),
                      extract.otherUnits
                        .map((u) => `${unitKindLabels[u.kind]} ${u.label}`)
                        .join(', '),
                    ],
                  ] as const)
                : []),
            ]}
          />
        </Section>
      )}

      <Section title={m.extract_holders()}>
        <ul className="grid gap-1 text-sm">
          {extract.holders.map((h) => (
            <li key={h.name} className="flex justify-between gap-4">
              <span>{h.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {m.extract_share({ percent: h.sharePercent })}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={m.extract_pledges()}>
        {extract.pledges.length === 0 ? (
          <p className="text-sm">{m.extract_pledges_none()}</p>
        ) : (
          <ol className="grid gap-3 text-sm">
            {extract.pledges.map((p) => (
              <li key={`${p.priority}`} className="flex gap-3">
                <span className="w-5 shrink-0 font-semibold tabular-nums">{p.priority}.</span>
                <Facts
                  facts={[
                    [
                      m.extract_pledge_creditor(),
                      [p.creditorName, p.creditorOrganizationNumber].filter(Boolean).join(', '),
                    ],
                    [m.extract_pledge_reference(), p.reference ?? missing],
                    [m.extract_pledge_notified(), p.notifiedOn],
                  ]}
                />
              </li>
            ))}
          </ol>
        )}
      </Section>

      {extract.released && extract.released.length > 0 && (
        <Section title={m.extract_released()}>
          <ul className="grid gap-2 text-sm">
            {extract.released.map((p) => (
              <li key={`${p.creditorName}-${p.notifiedOn}-${p.releasedOn}`}>
                <span className="font-medium">{p.creditorName}</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {[
                    p.reference,
                    `${m.extract_pledge_notified()} ${p.notifiedOn}`,
                    `${m.extract_released_on()} ${p.releasedOn}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <footer className="border-t pt-4 text-muted-foreground text-xs">
        {extract.producedBy.on
          ? m.extract_produced_via({
              date: extract.producedOn,
              name: extract.producedBy.name,
              organization: extract.producedBy.on,
            })
          : m.extract_produced({ date: extract.producedOn, name: extract.producedBy.name })}
      </footer>
    </article>
  )
}
