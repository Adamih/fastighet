import type { AgreementKind, PartyRole } from '#/features/agreements/kinds'
import { m } from '#/paraglide/messages'

// Wording for agreements in Mina sidor. Client-safe.

export const agreementKindLabels: Record<AgreementKind, () => string> = {
  lease: m.portal_agreement_lease,
  tenant_ownership: m.portal_agreement_ownership,
}

export const partyRoleLabels: Record<PartyRole, () => string> = {
  tenant: m.portal_role_tenant,
  co_tenant: m.portal_role_co_tenant,
  owner: m.portal_role_owner,
}
