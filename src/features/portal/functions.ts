import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import {
  invitePortalUser,
  portalAccessFor,
  resendPortalInvitation,
  revokePortalAccess,
  revokePortalInvitation,
} from './access-program'
import { AccessIdInput, InvitationIdInput, InvitePortalUserInput, PartyIdInput } from './schemas'

// Staff-side server functions for portal access, on the tenant page.

const origin = () => new URL(getRequest().url).origin
const RequestId = Schema.optional(Schema.String.check(Schema.isMaxLength(100)))

export const portalAccessFn = createServerFn({ method: 'GET' })
  .validator(validate(PartyIdInput))
  .handler(({ data }) => runApp(portalAccessFor(data.partyId)))

export const invitePortalUserFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ ...InvitePortalUserInput.fields, requestId: RequestId })))
  .handler(({ data }) =>
    runApp(
      once('invitePortalUser', data, { tenant: ['manage'] }, invitePortalUser(data, origin())),
      audit('portal.invite', data.partyId),
    ),
  )

export const resendPortalInvitationFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ ...InvitationIdInput.fields, requestId: RequestId })))
  .handler(({ data }) =>
    runApp(
      once(
        'resendPortalInvitation',
        data,
        { tenant: ['manage'] },
        resendPortalInvitation(data.invitationId, origin()),
      ),
      audit('portal.resend_invitation', null),
    ),
  )

export const revokePortalInvitationFn = createServerFn({ method: 'POST' })
  .validator(validate(InvitationIdInput))
  .handler(({ data }) =>
    runApp(revokePortalInvitation(data.invitationId), audit('portal.revoke_invitation', null)),
  )

export const revokePortalAccessFn = createServerFn({ method: 'POST' })
  .validator(validate(AccessIdInput))
  .handler(({ data }) =>
    runApp(revokePortalAccess(data.accessId), audit('portal.revoke_access', null)),
  )

export const portalAccessQuery = (partyId: string) =>
  queryOptions({
    queryKey: ['tenants', partyId, 'portal'],
    queryFn: () => portalAccessFn({ data: { partyId } }),
  })
