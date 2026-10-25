// Pure rules for the parties on an agreement: who the avi goes to and the name printed on it.
// Shared by the server (invoice runs) and the UI (previews).

export interface Party {
  readonly position: number
  readonly receivesInvoices: boolean
  readonly party: {
    readonly id: string
    readonly name: string
    readonly streetAddress: string | null
    readonly postalCode: string | null
    readonly city: string | null
    readonly email: string | null
  }
}

const byPosition = <P extends { position: number }>(parties: readonly P[]) =>
  [...parties].sort((a, b) => a.position - b.position)

/** "Anna Svensson", "Anna Svensson och Erik Svensson", "A, B och C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} och ${names.at(-1)}`
}

/**
 * What an avi copies at issue time: every party's name, and the address and email of the party
 * that receives the invoices (the first party if none is marked).
 */
export function invoiceRecipient(parties: readonly Party[]) {
  const ordered = byPosition(parties)
  const receiver = ordered.find((p) => p.receivesInvoices) ?? ordered[0]
  if (!receiver) throw new Error('An agreement has at least one party')
  const { party } = receiver
  return {
    partyId: party.id,
    recipientName: joinNames(ordered.map((p) => p.party.name)),
    recipientStreetAddress: party.streetAddress,
    recipientPostalCode: party.postalCode,
    recipientCity: party.city,
    recipientEmail: party.email,
  }
}

/** The party named first, shown where a single name fits (lists, headers). */
export const primaryParty = <P extends { position: number }>(parties: readonly P[]): P => {
  const first = byPosition(parties)[0]
  if (!first) throw new Error('An agreement has at least one party')
  return first
}

export type PartiesProblem = 'duplicate' | 'too_many' | 'receiver'

/** A lease has at most this many tenants. */
export const MAX_PARTIES = 6

/**
 * The party rows for a lease: the tenant first, then co-tenants in the order given, with exactly
 * one receiving the invoices (`receiverId`, or the tenant when null).
 */
export function leaseParties(
  tenantId: string,
  coTenantIds: readonly string[],
  receiverId: string | null,
):
  | {
      ok: true
      parties: {
        partyId: string
        role: 'tenant' | 'co_tenant'
        receivesInvoices: boolean
        position: number
      }[]
    }
  | { ok: false; problem: PartiesProblem } {
  const ids = [tenantId, ...coTenantIds]
  if (new Set(ids).size !== ids.length) return { ok: false, problem: 'duplicate' }
  if (ids.length > MAX_PARTIES) return { ok: false, problem: 'too_many' }
  const receiver = receiverId ?? tenantId
  if (!ids.includes(receiver)) return { ok: false, problem: 'receiver' }
  return {
    ok: true,
    parties: ids.map((id, index) => ({
      partyId: id,
      role: index === 0 ? 'tenant' : 'co_tenant',
      receivesInvoices: id === receiver,
      position: index + 1,
    })),
  }
}

export type OwnersProblem = 'none' | 'duplicate' | 'too_many' | 'shares' | 'receiver'

/**
 * The party rows for a bostadsrätt: its owners in the order given, each with a whole-percent
 * share, together exactly 100 %, and one of them receiving the invoices (the first when null).
 */
export function ownershipParties(
  owners: readonly { partyId: string; sharePercent: number }[],
  receiverId: string | null,
):
  | {
      ok: true
      parties: {
        partyId: string
        role: 'owner'
        sharePercent: number
        receivesInvoices: boolean
        position: number
      }[]
    }
  | { ok: false; problem: OwnersProblem } {
  if (owners.length === 0) return { ok: false, problem: 'none' }
  const ids = owners.map((o) => o.partyId)
  if (new Set(ids).size !== ids.length) return { ok: false, problem: 'duplicate' }
  if (ids.length > MAX_PARTIES) return { ok: false, problem: 'too_many' }
  const validShare = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100
  const total = owners.reduce((sum, o) => sum + o.sharePercent, 0)
  if (!owners.every((o) => validShare(o.sharePercent)) || total !== 100) {
    return { ok: false, problem: 'shares' }
  }
  const receiver = receiverId ?? ids[0]
  if (!ids.includes(receiver)) return { ok: false, problem: 'receiver' }
  return {
    ok: true,
    parties: owners.map((o, index) => ({
      partyId: o.partyId,
      role: 'owner',
      sharePercent: o.sharePercent,
      receivesInvoices: o.partyId === receiver,
      position: index + 1,
    })),
  }
}

/** Equal whole-percent shares that add up to 100, the first owners taking the remainder. */
export function equalShares(count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(100 / count)
  return Array.from({ length: count }, (_, i) => base + (i < 100 - base * count ? 1 : 0))
}
