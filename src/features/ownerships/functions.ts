import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import type { Permissions } from '#/lib/permissions'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import {
  createOwnership,
  deleteOwnership,
  getOwnership,
  listOwnerships,
  transferOwnership,
  updateOwnership,
} from './program'
import {
  CreateOwnershipInput,
  OwnershipIdInput,
  TransferOwnershipInput,
  UpdateOwnershipInput,
} from './schemas'

/** Creating and transferring write new records, so a retried request must not repeat them. */
const writes: Permissions = { lease: ['manage'], tenant: ['read'], property: ['read'] }

export const listOwnershipsFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(listOwnerships),
)

export const getOwnershipFn = createServerFn({ method: 'GET' })
  .validator(validate(OwnershipIdInput))
  .handler(({ data }) => runApp(getOwnership(data.ownershipId)))

export const createOwnershipFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...CreateOwnershipInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(once('createOwnership', data, writes, createOwnership(data)), audit('ownership.create')),
  )

export const updateOwnershipFn = createServerFn({ method: 'POST' })
  .validator(validate(UpdateOwnershipInput))
  .handler(({ data }) => runApp(updateOwnership(data), audit('ownership.update', data.ownershipId)))

export const transferOwnershipFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...TransferOwnershipInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once('transferOwnership', data, writes, transferOwnership(data)),
      audit('ownership.transfer', data.ownershipId),
    ),
  )

export const deleteOwnershipFn = createServerFn({ method: 'POST' })
  .validator(validate(OwnershipIdInput))
  .handler(({ data }) => runApp(deleteOwnership(data.ownershipId), audit('ownership.delete', null)))

export const ownershipsQuery = () =>
  queryOptions({ queryKey: ['ownerships'], queryFn: () => listOwnershipsFn() })

export const ownershipQuery = (ownershipId: string) =>
  queryOptions({
    queryKey: ['ownerships', ownershipId],
    queryFn: () => getOwnershipFn({ data: { ownershipId } }),
  })
