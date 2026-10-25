// Pure rules for the parties on an agreement: who the avi goes to and the name printed on it.
// Shared by the server (invoice runs) and the UI (previews).

export interface Party {
  readonly position: number
  readonly receivesInvoices: boolean
  readonly tenant: {
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
  const { tenant } = receiver
  return {
    tenantId: tenant.id,
    recipientName: joinNames(ordered.map((p) => p.tenant.name)),
    recipientStreetAddress: tenant.streetAddress,
    recipientPostalCode: tenant.postalCode,
    recipientCity: tenant.city,
    recipientEmail: tenant.email,
  }
}

/** The party named first, shown where a single name fits (lists, headers). */
export const primaryParty = <P extends { position: number }>(parties: readonly P[]): P => {
  const first = byPosition(parties)[0]
  if (!first) throw new Error('An agreement has at least one party')
  return first
}
