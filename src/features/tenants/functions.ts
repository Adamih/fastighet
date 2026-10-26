import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import { createTenant, deleteTenant, getTenant, listTenants, updateTenant } from './program'
import { CreateTenantInput, TenantIdInput, UpdateTenantInput } from './schemas'

export const listTenantsFn = createServerFn({ method: 'GET' }).handler(() => runApp(listTenants))

export const getTenantFn = createServerFn({ method: 'GET' })
  .validator(validate(TenantIdInput))
  .handler(({ data }) => runApp(getTenant(data.tenantId)))

export const createTenantFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...CreateTenantInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once('createTenant', data, { tenant: ['manage'] }, createTenant(data)),
      audit('tenant.create'),
    ),
  )

export const updateTenantFn = createServerFn({ method: 'POST' })
  .validator(validate(UpdateTenantInput))
  .handler(({ data }) => runApp(updateTenant(data), audit('tenant.update', data.tenantId)))

export const deleteTenantFn = createServerFn({ method: 'POST' })
  .validator(validate(TenantIdInput))
  .handler(({ data }) => runApp(deleteTenant(data.tenantId), audit('tenant.delete', null)))

export const tenantsQuery = () =>
  queryOptions({ queryKey: ['tenants'], queryFn: () => listTenantsFn() })

export const tenantQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ['tenants', tenantId],
    queryFn: () => getTenantFn({ data: { tenantId } }),
  })
