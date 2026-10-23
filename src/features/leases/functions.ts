import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import {
  createLease,
  deleteLease,
  getLease,
  listLeases,
  terminateLease,
  updateLease,
  withdrawTermination,
} from './program'
import { CreateLeaseInput, LeaseIdInput, TerminateLeaseInput, UpdateLeaseInput } from './schemas'

const std = Schema.toStandardSchemaV1

export const listLeasesFn = createServerFn({ method: 'GET' }).handler(() => runApp(listLeases))

export const getLeaseFn = createServerFn({ method: 'GET' })
  .validator(std(LeaseIdInput))
  .handler(({ data }) => runApp(getLease(data.leaseId)))

export const createLeaseFn = createServerFn({ method: 'POST' })
  .validator(std(CreateLeaseInput))
  .handler(({ data }) => runApp(createLease(data)))

export const updateLeaseFn = createServerFn({ method: 'POST' })
  .validator(std(UpdateLeaseInput))
  .handler(({ data }) => runApp(updateLease(data)))

export const terminateLeaseFn = createServerFn({ method: 'POST' })
  .validator(std(TerminateLeaseInput))
  .handler(({ data }) => runApp(terminateLease(data)))

export const withdrawTerminationFn = createServerFn({ method: 'POST' })
  .validator(std(LeaseIdInput))
  .handler(({ data }) => runApp(withdrawTermination(data.leaseId)))

export const deleteLeaseFn = createServerFn({ method: 'POST' })
  .validator(std(LeaseIdInput))
  .handler(({ data }) => runApp(deleteLease(data.leaseId)))

export const leasesQuery = () =>
  queryOptions({ queryKey: ['leases'], queryFn: () => listLeasesFn() })

export const leaseQuery = (leaseId: string) =>
  queryOptions({ queryKey: ['leases', leaseId], queryFn: () => getLeaseFn({ data: { leaseId } }) })
