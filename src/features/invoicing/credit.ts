import type { ChargeKind } from '#/features/agreements/kinds'

// Pure rules for credit notes (kreditfakturor): what can still be credited on an invoice and the
// lines a credit note gets. Shared by the server (creating them) and the client (the preview).

export interface CreditableInvoice {
  readonly number: number
  readonly totalOre: number
  readonly creditedOre: number
  readonly voidedAt: Date | null
  readonly lines: readonly {
    readonly kind: ChargeKind
    readonly description: string
    readonly netOre: number
    readonly vatRatePercent: number
    readonly vatOre: number
  }[]
}

/** What the tenant still owes (or, once paid, what a credit note can still give back). */
export const remainingOre = (invoice: { totalOre: number; creditedOre: number }) =>
  Math.max(0, invoice.totalOre - invoice.creditedOre)

/** For lists: what is still owed on an open invoice, otherwise its total. */
export const owedOrTotal = (invoice: { status: string; totalOre: number; creditedOre: number }) =>
  invoice.status === 'unpaid' || invoice.status === 'overdue'
    ? remainingOre(invoice)
    : invoice.totalOre

/**
 * The VAT rate a partial credit uses: the first (base) line's. An avi can mix rates when an
 * add-on carries VAT and the rent doesn't; crediting all of an untouched avi repeats each line.
 */
export const vatRateOf = (invoice: Pick<CreditableInvoice, 'lines'>) =>
  invoice.lines[0]?.vatRatePercent ?? 0

/** `rest`: everything not yet credited. `amount`: a part, given excluding VAT. */
export type CreditRequest = { readonly kind: 'rest' } | { readonly kind: 'amount'; netOre: number }

export interface CreditNoteDraft {
  readonly lines: {
    kind: ChargeKind
    description: string
    netOre: number
    vatRatePercent: number
    vatOre: number
  }[]
  readonly netOre: number
  readonly vatOre: number
  readonly totalOre: number
}

export type CreditProblem = 'void' | 'nothing_left' | 'not_positive' | 'too_much'

/**
 * The credit note for `request`, or why there can't be one. Crediting a whole untouched invoice
 * repeats its lines; anything else is one line, with VAT at the invoice's rate.
 */
export function draftCreditNote(
  invoice: CreditableInvoice,
  request: CreditRequest,
): { ok: true; draft: CreditNoteDraft } | { ok: false; problem: CreditProblem } {
  if (invoice.voidedAt) return { ok: false, problem: 'void' }
  const left = remainingOre(invoice)
  if (left === 0) return { ok: false, problem: 'nothing_left' }

  if (request.kind === 'rest' && invoice.creditedOre === 0) {
    const lines = invoice.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      netOre: l.netOre,
      vatRatePercent: l.vatRatePercent,
      vatOre: l.vatOre,
    }))
    return { ok: true, draft: totals(lines) }
  }

  const rate = vatRateOf(invoice)
  let netOre: number
  let vatOre: number
  if (request.kind === 'rest') {
    // Split what is left back into net and VAT; the VAT absorbs the rounding.
    netOre = Math.round((left * 100) / (100 + rate))
    vatOre = left - netOre
  } else {
    netOre = request.netOre
    if (!Number.isInteger(netOre) || netOre <= 0) return { ok: false, problem: 'not_positive' }
    vatOre = Math.round((netOre * rate) / 100)
    if (netOre + vatOre > left) return { ok: false, problem: 'too_much' }
  }
  const description =
    request.kind === 'rest'
      ? `Kreditering av resterande belopp, avi ${invoice.number}`
      : `Kreditering, avi ${invoice.number}`
  return {
    ok: true,
    draft: totals([
      { kind: invoice.lines[0]?.kind ?? 'rent', description, netOre, vatRatePercent: rate, vatOre },
    ]),
  }
}

function totals(lines: CreditNoteDraft['lines']): CreditNoteDraft {
  const netOre = lines.reduce((sum, l) => sum + l.netOre, 0)
  const vatOre = lines.reduce((sum, l) => sum + l.vatOre, 0)
  return { lines, netOre, vatOre, totalOre: netOre + vatOre }
}
