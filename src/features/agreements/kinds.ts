// Client-safe constants for agreements. Kept apart from the programs so the UI can import them.

/**
 * What an agreement is. A lease (hyresavtal) for rentals and commercial premises; a tenant-owner
 * right (bostadsrätt) for a BRF's members. Both are billed the same way.
 */
export const agreementKinds = ['lease', 'tenant_ownership'] as const
export type AgreementKind = (typeof agreementKinds)[number]

/**
 * A party's place on an agreement: the tenant, another tenant on the same lease, or an owner of
 * a bostadsrätt (often two, with shares).
 */
export const partyRoles = ['tenant', 'co_tenant', 'owner'] as const
export type PartyRole = (typeof partyRoles)[number]
