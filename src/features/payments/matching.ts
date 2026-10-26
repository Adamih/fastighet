import { joinNames } from '#/features/agreements/parties'
import { formatSek } from '#/lib/money'
import type { ParsedPayment } from './camt054'

// Where an incoming payment goes. Pure, so it can be unit-tested; client-safe.
//
// An avi's OCR number says whose payment it is and which avi it is meant for. The payment goes
// to that avi first, then to the same party's other unpaid avier, oldest first, and what is left
// becomes the party's credit balance (tillgodo). A payment without a known OCR waits for a
// person, who picks the party; the same rule then splits it.

export const paymentStatuses = ['matched', 'review', 'unmatched', 'ignored'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  matched: 'Bokförd',
  review: 'Kontrollera',
  unmatched: 'Ej kopplad',
  ignored: 'Ignorerad',
}

/** A party's avi with something still owed. */
export interface OpenAvi {
  readonly id: string
  readonly number: number
  readonly dueDate: string
  readonly owedOre: number
}

/** Part of a payment: to an avi, or (`invoiceId` null) to the party's credit balance. */
export interface Allocation {
  readonly invoiceId: string | null
  readonly amountOre: number
}

/**
 * Splits `amountOre` over the party's open avier: the avi the payment names first, then the
 * others by due date (oldest first), and the rest to the credit balance.
 */
export function allocate(
  amountOre: number,
  open: readonly OpenAvi[],
  namedInvoiceId: string | null = null,
): Allocation[] {
  const ordered = [...open]
    .filter((a) => a.owedOre > 0)
    .sort(
      (a, b) =>
        Number(b.id === namedInvoiceId) - Number(a.id === namedInvoiceId) ||
        a.dueDate.localeCompare(b.dueDate) ||
        a.number - b.number,
    )
  const result: Allocation[] = []
  let left = amountOre
  for (const avi of ordered) {
    if (left <= 0) break
    const part = Math.min(left, avi.owedOre)
    result.push({ invoiceId: avi.id, amountOre: part })
    left -= part
  }
  if (left > 0) result.push({ invoiceId: null, amountOre: left })
  return result
}

export interface MatchResult {
  readonly status: 'matched' | 'unmatched'
  /** The party the OCR belongs to. */
  readonly partyId: string | null
  readonly allocations: readonly Allocation[]
}

/**
 * Matches a bank file's payments by OCR. Payments are handled in order, so two payments for the
 * same avi in one file don't both settle it: the second goes to the next avi or to credit.
 */
export function matchPayments(
  payments: readonly ParsedPayment[],
  avierByOcr: ReadonlyMap<string, { readonly id: string; readonly partyId: string }>,
  openByParty: ReadonlyMap<string, readonly OpenAvi[]>,
): MatchResult[] {
  const owed = new Map<string, OpenAvi[]>(
    [...openByParty].map(([party, avier]) => [party, avier.map((a) => ({ ...a }))]),
  )
  return payments.map((p): MatchResult => {
    const ocr = p.reference?.replace(/\D/g, '') ?? ''
    const named = ocr ? avierByOcr.get(ocr) : undefined
    if (!named || p.amountOre <= 0) return { status: 'unmatched', partyId: null, allocations: [] }
    const open = owed.get(named.partyId) ?? []
    const allocations = allocate(p.amountOre, open, named.id)
    owed.set(
      named.partyId,
      open.map((a) => ({
        ...a,
        owedOre:
          a.owedOre - allocations.reduce((s, x) => s + (x.invoiceId === a.id ? x.amountOre : 0), 0),
      })),
    )
    return { status: 'matched', partyId: named.partyId, allocations }
  })
}

/**
 * Where a payment went, in words: "Betalade avi 1042 och 1043", "8 000,00 kr på avi 1042,
 * 500,00 kr tillgodo", "Tillgodo".
 */
export function allocationSummary(
  allocations: readonly { invoiceId: string | null; amountOre: number; number?: number }[],
): string {
  const avier = allocations.filter((a) => a.invoiceId !== null)
  const credit = allocations.find((a) => a.invoiceId === null)
  if (avier.length === 0) return credit ? 'Tillgodo' : ''
  if (!credit) return `Betalade avi ${joinNames(avier.map((a) => String(a.number ?? '')))}`
  return [
    ...avier.map((a) => `${formatSek(a.amountOre)} på avi ${a.number ?? ''}`),
    `${formatSek(credit.amountOre)} tillgodo`,
  ].join(', ')
}
