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
  ownershipExtract,
  transferOwnership,
  updateOwnership,
} from './program'
import {
  CreateOwnershipInput,
  OwnershipExtractInput,
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

/**
 * Produces an extract, so it is audited although it only reads. The page fetches it from the
 * component (not a route loader), so hovering a link doesn't produce one.
 */
export const ownershipExtractFn = createServerFn({ method: 'GET' })
  .validator(validate(OwnershipExtractInput))
  .handler(({ data }) =>
    runApp(ownershipExtract(data), audit('ownership.extract', data.ownershipId)),
  )

export const ownershipExtractQuery = (input: OwnershipExtractInput) =>
  queryOptions({
    queryKey: ['ownerships', input.ownershipId, 'extract', input.onDate, input.includeReleased],
    queryFn: () => ownershipExtractFn({ data: input }),
    // An extract is a document as of a date; refetching would only add audit entries.
    staleTime: Number.POSITIVE_INFINITY,
  })

export const ownershipsQuery = () =>
  queryOptions({ queryKey: ['ownerships'], queryFn: () => listOwnershipsFn() })

export const ownershipQuery = (ownershipId: string) =>
  queryOptions({
    queryKey: ['ownerships', ownershipId],
    queryFn: () => getOwnershipFn({ data: { ownershipId } }),
  })
