import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import {
  acceptRequest,
  assignStaff,
  endClient,
  listClients,
  listManagers,
  managerActivity,
  previewRequest,
  requestAccess,
  revokeGrant,
  updateGrant,
  withdrawRequest,
} from './program'
import {
  AcceptRequestInput,
  AssignStaffInput,
  CodeInput,
  GrantIdInput,
  RequestAccessInput,
  RequestIdInput,
  UpdateGrantInput,
} from './schemas'

const std = Schema.toStandardSchemaV1

// --- Kundbolag (the managing company).

export const listClientsFn = createServerFn({ method: 'GET' }).handler(() => runApp(listClients))

export const requestAccessFn = createServerFn({ method: 'POST' })
  .validator(std(RequestAccessInput))
  .handler(({ data }) =>
    runApp(
      requestAccess(data, new URL(getRequest().url).origin),
      audit('management.request', null),
    ),
  )

export const withdrawRequestFn = createServerFn({ method: 'POST' })
  .validator(std(RequestIdInput))
  .handler(({ data }) =>
    runApp(withdrawRequest(data.requestId), audit('management.withdraw_request', null)),
  )

export const assignStaffFn = createServerFn({ method: 'POST' })
  .validator(std(AssignStaffInput))
  .handler(({ data }) => runApp(assignStaff(data), audit('management.assign', null)))

export const endClientFn = createServerFn({ method: 'POST' })
  .validator(std(GrantIdInput))
  .handler(({ data }) => runApp(endClient(data.grantId), audit('management.end_client', null)))

export const clientsQuery = () =>
  queryOptions({ queryKey: ['management', 'clients'], queryFn: () => listClientsFn() })

// --- Förvaltare (the managed company).

export const listManagersFn = createServerFn({ method: 'GET' }).handler(() => runApp(listManagers))

export const previewRequestFn = createServerFn({ method: 'POST' })
  .validator(std(CodeInput))
  .handler(({ data }) => runApp(previewRequest(data.code)))

export const acceptRequestFn = createServerFn({ method: 'POST' })
  .validator(std(AcceptRequestInput))
  .handler(({ data }) => runApp(acceptRequest(data), audit('management.accept', null)))

export const updateGrantFn = createServerFn({ method: 'POST' })
  .validator(std(UpdateGrantInput))
  .handler(({ data }) => runApp(updateGrant(data), audit('management.update_grant', null)))

export const revokeGrantFn = createServerFn({ method: 'POST' })
  .validator(std(GrantIdInput))
  .handler(({ data }) => runApp(revokeGrant(data.grantId), audit('management.revoke_grant', null)))

export const managersQuery = () =>
  queryOptions({ queryKey: ['management', 'managers'], queryFn: () => listManagersFn() })

export const managerActivityFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(managerActivity),
)

export const managerActivityQuery = () =>
  queryOptions({ queryKey: ['management', 'activity'], queryFn: () => managerActivityFn() })
