import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import {
  changeLeaseFrom,
  createLease,
  deleteLease,
  getLease,
  listLeases,
  terminateLease,
  updateLease,
  withdrawTermination,
} from './program'
import {
  ChangeLeaseFromInput,
  CreateLeaseInput,
  LeaseIdInput,
  TerminateLeaseInput,
  UpdateLeaseInput,
} from './schemas'

const std = validate

export const listLeasesFn = createServerFn({ method: 'GET' }).handler(() => runApp(listLeases))

export const getLeaseFn = createServerFn({ method: 'GET' })
  .validator(std(LeaseIdInput))
  .handler(({ data }) => runApp(getLease(data.leaseId)))

export const createLeaseFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...CreateLeaseInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once(
        'createLease',
        data,
        { lease: ['manage'], tenant: ['read'], property: ['read'] },
        createLease(data),
      ),
    ),
  )

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

export const changeLeaseFromFn = createServerFn({ method: 'POST' })
  .validator(std(ChangeLeaseFromInput))
  .handler(({ data }) => runApp(changeLeaseFrom(data)))

export const leasesQuery = () =>
  queryOptions({ queryKey: ['leases'], queryFn: () => listLeasesFn() })

export const leaseQuery = (leaseId: string) =>
  queryOptions({ queryKey: ['leases', leaseId], queryFn: () => getLeaseFn({ data: { leaseId } }) })
