import { queryOptions } from '@tanstack/react-query'
import { notFound, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { adminOfRequest, runAdmin } from '#/server/admin'
import { validate } from '#/server/validate'
import {
  banUser,
  getCompany,
  getUser,
  listAdminEvents,
  listCompanies,
  listUsers,
  overview,
  revokeSessions,
  setAdmin,
  setPlanOverride,
  unbanUser,
} from './program'

// The admin dashboard's server functions. Each runs through `runAdmin`, which gives anyone who
// isn't an admin (or is impersonating) a 404. Writes record themselves in the admin log.

/** The signed-in admin, for the dashboard's layout; others get a 404, the signed-out /login. */
export const getAdminContextFn = createServerFn({ method: 'GET' }).handler(async () => {
  const found = await adminOfRequest()
  if (!found) throw redirect({ to: '/login', search: { redirect: '/admin' } })
  if (!found.admin) throw notFound()
  return found.user
})

const Search = Schema.Struct({ search: Schema.String.check(Schema.isMaxLength(100)) })
const UserId = Schema.Struct({ userId: Schema.String })
const OrganizationId = Schema.Struct({ organizationId: Schema.String })

export const overviewFn = createServerFn({ method: 'GET' }).handler(() => runAdmin(overview))

export const usersFn = createServerFn({ method: 'GET' })
  .validator(validate(Search))
  .handler(({ data }) => runAdmin(listUsers(data.search)))

export const userFn = createServerFn({ method: 'GET' })
  .validator(validate(UserId))
  .handler(({ data }) => runAdmin(getUser(data.userId)))

export const companiesFn = createServerFn({ method: 'GET' })
  .validator(validate(Search))
  .handler(({ data }) => runAdmin(listCompanies(data.search)))

export const companyFn = createServerFn({ method: 'GET' })
  .validator(validate(OrganizationId))
  .handler(({ data }) => runAdmin(getCompany(data.organizationId)))

export const adminEventsFn = createServerFn({ method: 'GET' }).handler(() =>
  runAdmin(listAdminEvents),
)

export const setPlanOverrideFn = createServerFn({ method: 'POST' })
  .validator(
    validate(Schema.Struct({ organizationId: Schema.String, tier: Schema.NullOr(Schema.String) })),
  )
  .handler(({ data }) => runAdmin(setPlanOverride(data)))

export const banUserFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        userId: Schema.String,
        reason: Schema.String.check(Schema.isMaxLength(500)),
        days: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
      }),
    ),
  )
  .handler(({ data }) => runAdmin(banUser(data)))

export const unbanUserFn = createServerFn({ method: 'POST' })
  .validator(validate(UserId))
  .handler(({ data }) => runAdmin(unbanUser(data.userId)))

export const setAdminFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ userId: Schema.String, admin: Schema.Boolean })))
  .handler(({ data }) => runAdmin(setAdmin(data)))

export const revokeSessionsFn = createServerFn({ method: 'POST' })
  .validator(validate(UserId))
  .handler(({ data }) => runAdmin(revokeSessions(data.userId)))

export const adminOverviewQuery = () =>
  queryOptions({ queryKey: ['admin', 'overview'], queryFn: () => overviewFn() })
export const adminUsersQuery = (search: string) =>
  queryOptions({
    queryKey: ['admin', 'users', search],
    queryFn: () => usersFn({ data: { search } }),
  })
export const adminUserQuery = (userId: string) =>
  queryOptions({ queryKey: ['admin', 'user', userId], queryFn: () => userFn({ data: { userId } }) })
export const adminCompaniesQuery = (search: string) =>
  queryOptions({
    queryKey: ['admin', 'companies', search],
    queryFn: () => companiesFn({ data: { search } }),
  })
export const adminCompanyQuery = (organizationId: string) =>
  queryOptions({
    queryKey: ['admin', 'company', organizationId],
    queryFn: () => companyFn({ data: { organizationId } }),
  })
export const adminEventsQuery = () =>
  queryOptions({ queryKey: ['admin', 'events'], queryFn: () => adminEventsFn() })
