import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { createTenant, listTenants } from './program'
import { CreateTenantInput } from './schemas'

export const listTenantsFn = createServerFn({ method: 'GET' }).handler(() => runApp(listTenants))

export const createTenantFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(CreateTenantInput))
  .handler(({ data }) => runApp(createTenant(data)))

export const tenantsQuery = () =>
  queryOptions({ queryKey: ['tenants'], queryFn: () => listTenantsFn() })
