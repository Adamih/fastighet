import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { createLease, getLease, listLeases, terminateLease } from './program'
import { CreateLeaseInput, LeaseIdInput, TerminateLeaseInput } from './schemas'

export const listLeasesFn = createServerFn({ method: 'GET' }).handler(() => runApp(listLeases))

export const getLeaseFn = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(LeaseIdInput))
  .handler(({ data }) => runApp(getLease(data.leaseId)))

export const createLeaseFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(CreateLeaseInput))
  .handler(({ data }) => runApp(createLease(data)))

export const terminateLeaseFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(TerminateLeaseInput))
  .handler(({ data }) => runApp(terminateLease(data)))

export const leasesQuery = () =>
  queryOptions({ queryKey: ['leases'], queryFn: () => listLeasesFn() })

export const leaseQuery = (leaseId: string) =>
  queryOptions({ queryKey: ['leases', leaseId], queryFn: () => getLeaseFn({ data: { leaseId } }) })
