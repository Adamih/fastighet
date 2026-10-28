import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  desktopTableClass,
  MobileList,
  MobileListLink,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
import { adminCompaniesQuery } from '#/features/admin/functions'
import { SearchBox } from '#/features/admin/search-box'
import { tiers } from '#/features/billing/tiers'
import { companyKindLabels } from '#/features/settings/company-kinds'
import { stockholmDate } from '#/lib/dates'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/admin/companies/')({
  validateSearch: (search): { q?: string } => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
  }),
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(adminCompaniesQuery(deps.q)),
  component: CompaniesPage,
})

function CompaniesPage() {
  const { q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: companies } = useSuspenseQuery(adminCompaniesQuery(q))
  return (
    <div className="grid gap-5">
      <PageHeader title={m.admin_nav_companies()} subtitle={m.admin_list_limit()} />
      <SearchBox
        value={q}
        label={m.admin_search_companies()}
        placeholder={m.admin_search_companies()}
        onSearch={(text) => navigate({ search: { q: text || undefined }, replace: true })}
      />
      {companies.length === 0 ? (
        <p className="text-muted-foreground text-sm">{m.admin_none_found()}</p>
      ) : (
        <>
          <table className={desktopTableClass}>
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-2 font-medium">{m.admin_company()}</th>
                <th className="py-2 font-medium">{m.admin_tier()}</th>
                <th className="py-2 text-right font-medium">{m.admin_members()}</th>
                <th className="py-2 text-right font-medium">{m.admin_units()}</th>
                <th className="py-2 pl-4 font-medium">{m.admin_created()}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2.5 pr-4">
                    <Link
                      to="/admin/companies/$organizationId"
                      params={{ organizationId: c.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {c.name}
                    </Link>
                    <div className="text-muted-foreground">{companyKindLabels[c.kind]}</div>
                  </td>
                  <td className="py-2.5 pr-4">{tiers[c.tier].name()}</td>
                  <td className="py-2.5 text-right tabular-nums">{c.members}</td>
                  <td className="py-2.5 text-right tabular-nums">{c.units}</td>
                  <td className="py-2.5 pl-4 tabular-nums">{stockholmDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <MobileList>
            {companies.map((c) => (
              <li key={c.id}>
                <MobileListLink
                  to="/admin/companies/$organizationId"
                  params={{ organizationId: c.id }}
                >
                  <RowTitle end={tiers[c.tier].name()}>{c.name}</RowTitle>
                  <RowMeta>
                    {[
                      companyKindLabels[c.kind],
                      m.admin_members_count({ count: c.members }),
                      m.admin_units_count({ count: c.units }),
                    ].join(' · ')}
                  </RowMeta>
                </MobileListLink>
              </li>
            ))}
          </MobileList>
        </>
      )}
    </div>
  )
}
