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

/**
 * What a charge is for. `rent` (a lease) and `fee` (a bostadsrätt's månadsavgift) are the base
 * charge; the rest are add-ons, index increases and one-off amounts.
 */
export const chargeKinds = [
  'rent',
  'fee',
  'parking',
  'storage',
  'utility',
  'index',
  'one_off',
  'other',
  // A payment reminder's fee (påminnelseavgift), a one-off charge from sending the reminder
  // (`features/reminders`).
  'reminder_fee',
  // A BRF's pantsättningsavgift and överlåtelseavgift, one-off amounts from the pledge and sale
  // flows (`features/ownerships/fees.ts`).
  'pledge_fee',
  'transfer_fee',
  // Dröjsmålsränta on a late avi, a one-off amount from the payment that settled it
  // (`features/interest`).
  'late_interest',
] as const
export type ChargeKind = (typeof chargeKinds)[number]

/** `once` is a one-off amount, billed on the first avi that covers its date. */
export const chargeIntervals = ['monthly', 'yearly', 'once'] as const
export type ChargeInterval = (typeof chargeIntervals)[number]
