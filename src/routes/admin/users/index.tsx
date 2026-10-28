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
import { adminUsersQuery } from '#/features/admin/functions'
import { userBadges } from '#/features/admin/labels'
import { SearchBox } from '#/features/admin/search-box'
import { stockholmDate } from '#/lib/dates'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/admin/users/')({
  validateSearch: (search): { q?: string } => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
  }),
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(adminUsersQuery(deps.q)),
  component: UsersPage,
})

function UsersPage() {
  const { q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: users } = useSuspenseQuery(adminUsersQuery(q))
  return (
    <div className="grid gap-5">
      <PageHeader title={m.admin_nav_users()} subtitle={m.admin_list_limit()} />
      <SearchBox
        value={q}
        label={m.admin_search_users()}
        placeholder={m.admin_search_users()}
        onSearch={(text) => navigate({ search: { q: text || undefined }, replace: true })}
      />
      {users.length === 0 ? (
        <p className="text-muted-foreground text-sm">{m.admin_none_found()}</p>
      ) : (
        <>
          <table className={desktopTableClass}>
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="py-2 font-medium">{m.admin_user()}</th>
                <th className="py-2 font-medium">{m.admin_companies()}</th>
                <th className="py-2 font-medium">{m.admin_created()}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t align-top">
                  <td className="py-2.5 pr-4">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: u.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {u.name}
                    </Link>
                    <div className="text-muted-foreground">
                      {[u.email, userBadges(u)].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    {u.companies.map((c) => c.name).join(', ') || '–'}
                  </td>
                  <td className="py-2.5 tabular-nums">{stockholmDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <MobileList>
            {users.map((u) => (
              <li key={u.id}>
                <MobileListLink to="/admin/users/$userId" params={{ userId: u.id }}>
                  <RowTitle end={userBadges(u)}>{u.name}</RowTitle>
                  <RowMeta>
                    {[u.email, u.companies.map((c) => c.name).join(', ')]
                      .filter(Boolean)
                      .join(' · ')}
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
