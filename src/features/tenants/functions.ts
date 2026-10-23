import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { createTenant, deleteTenant, getTenant, listTenants, updateTenant } from './program'
import { CreateTenantInput, TenantIdInput, UpdateTenantInput } from './schemas'

export const listTenantsFn = createServerFn({ method: 'GET' }).handler(() => runApp(listTenants))

export const getTenantFn = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(TenantIdInput))
  .handler(({ data }) => runApp(getTenant(data.tenantId)))

export const createTenantFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(CreateTenantInput))
  .handler(({ data }) => runApp(createTenant(data)))

export const updateTenantFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(UpdateTenantInput))
  .handler(({ data }) => runApp(updateTenant(data)))

export const deleteTenantFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(TenantIdInput))
  .handler(({ data }) => runApp(deleteTenant(data.tenantId)))

export const tenantsQuery = () =>
  queryOptions({ queryKey: ['tenants'], queryFn: () => listTenantsFn() })

export const tenantQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ['tenants', tenantId],
    queryFn: () => getTenantFn({ data: { tenantId } }),
  })
