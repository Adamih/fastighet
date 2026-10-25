import type { InvoiceStatus } from './rules'

// Pure rules for the invoice page: what has happened to the invoice.

export type InvoiceEventKind =
  | 'created'
  | 'sent'
  | 'fellDue'
  | 'paid'
  | 'voided'
  | 'credited'
  | 'refunded'
  | 'replaced'

export interface InvoiceEvent {
  readonly kind: InvoiceEventKind
  /** ISO date. */
  readonly date: string
  /** For `credited` and `refunded`: the credit note. */
  readonly creditNote?: { readonly number: number; readonly totalOre: number }
  /** For `replaced`: the corrected avi. */
  readonly invoiceNumber?: number
}

/** What has happened so far, newest first. Built from the invoice's stored dates. */
export function invoiceEvents(
  invoice: {
    status: InvoiceStatus
    /** The invoice date (fakturadatum). */
    createdOn: string
    sentOn: string | null
    dueDate: string
    paidOn: string | null
    voidedOn: string | null
    creditNotes?: readonly {
      number: number
      issueDate: string
      totalOre: number
      refundedOn?: string | null
    }[]
    /** Corrected avier issued in its place. */
    replacedBy?: readonly { number: number; issueDate: string }[]
  },
  today: string,
): InvoiceEvent[] {
  // It fell due if the due date passed while it was still unpaid (now or when it was paid), and
  // it had not already been credited in full by then.
  const settledByCredit =
    invoice.status === 'credited'
      ? (invoice.creditNotes ?? [])
          .map((n) => n.issueDate)
          .sort()
          .at(-1)
      : undefined
  const fellDue =
    invoice.dueDate < today &&
    !invoice.voidedOn &&
    (invoice.paidOn === null || invoice.paidOn > invoice.dueDate) &&
    !(settledByCredit && settledByCredit <= invoice.dueDate)
  const events: InvoiceEvent[] = [
    { kind: 'created', date: invoice.createdOn },
    ...(invoice.sentOn ? [{ kind: 'sent' as const, date: invoice.sentOn }] : []),
    ...(fellDue ? [{ kind: 'fellDue' as const, date: invoice.dueDate }] : []),
    ...(invoice.paidOn ? [{ kind: 'paid' as const, date: invoice.paidOn }] : []),
    ...(invoice.voidedOn ? [{ kind: 'voided' as const, date: invoice.voidedOn }] : []),
    ...(invoice.creditNotes ?? []).map((note) => ({
      kind: 'credited' as const,
      date: note.issueDate,
      creditNote: { number: note.number, totalOre: note.totalOre },
    })),
    ...(invoice.creditNotes ?? []).flatMap((note) =>
      note.refundedOn
        ? [
            {
              kind: 'refunded' as const,
              date: note.refundedOn,
              creditNote: { number: note.number, totalOre: note.totalOre },
            },
          ]
        : [],
    ),
    ...(invoice.replacedBy ?? []).map((replacement) => ({
      kind: 'replaced' as const,
      date: replacement.issueDate,
      invoiceNumber: replacement.number,
    })),
  ]
  return events
    .filter((e) => e.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || order[a.kind] - order[b.kind])
}

/** On the same day, later steps come first (the list is newest first). */
const order: Record<InvoiceEventKind, number> = {
  replaced: 0,
  refunded: 1,
  voided: 2,
  credited: 3,
  paid: 4,
  fellDue: 5,
  sent: 6,
  created: 7,
}
