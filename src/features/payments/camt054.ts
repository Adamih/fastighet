import { XMLParser } from 'fast-xml-parser'
import { isLuhnValid } from '#/lib/luhn'
import { parseSek } from '#/lib/money'

// Reads an ISO 20022 camt.054 (BankToCustomerDebitCreditNotification), the format Swedish banks
// use for incoming Bankgiro payments now that BgMax is retired. Only incoming SEK payments are
// returned; everything else is counted so the user can see what was left out.

export interface ParsedPayment {
  /** Stable id of the transaction, used to skip payments that were already imported. */
  readonly bankReference: string
  readonly bookingDate: string
  readonly amountOre: number
  /** The OCR number when one was given, otherwise any free-text remittance. */
  readonly reference: string | null
  readonly payerName: string | null
}

export interface ParsedNotification {
  readonly messageId: string | null
  readonly payments: ParsedPayment[]
  readonly skippedDebits: number
  readonly skippedOtherCurrency: number
}

export class Camt054Error extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'Ntfctn' || name === 'Ntry' || name === 'TxDtls' || name === 'Ustrd',
})

// biome-ignore lint/suspicious/noExplicitAny: walking untyped XML
type Node = any

const text = (node: Node): string | null => {
  if (node == null) return null
  if (typeof node === 'string') return node.trim() || null
  if (typeof node === 'object' && '#text' in node) return String(node['#text']).trim() || null
  return null
}

const amountOf = (node: Node): { ore: number; currency: string } | null => {
  const value = text(node)
  const ore = value === null ? null : parseSek(value)
  if (ore === null) return null
  return { ore, currency: node?.['@_Ccy'] ?? 'SEK' }
}

/** Prefers a structured creditor reference (OCR); falls back to OCR-looking or free text. */
function remittance(tx: Node): string | null {
  const structured = text(tx?.RmtInf?.Strd?.CdtrRefInf?.Ref)
  if (structured) return structured.replace(/\s/g, '')
  const lines: string[] = (tx?.RmtInf?.Ustrd ?? []).map(text).filter(Boolean)
  const ocr = lines
    .map((l) => l.replace(/\s/g, ''))
    .find((l) => /^\d{2,25}$/.test(l) && isLuhnValid(l))
  return ocr ?? (lines.join(' ') || null)
}

export function parseCamt054(xml: string): ParsedNotification {
  let doc: Node
  try {
    doc = parser.parse(xml)
  } catch (cause) {
    throw new Camt054Error('Filen är inte giltig XML', { cause })
  }
  const root = doc?.Document?.BkToCstmrDbtCdtNtfctn
  if (!root) throw new Camt054Error('Filen är inte en camt.054-avisering')

  const payments: ParsedPayment[] = []
  let skippedDebits = 0
  let skippedOtherCurrency = 0

  for (const notification of root.Ntfctn ?? []) {
    for (const [entryIndex, entry] of (notification.Ntry ?? []).entries()) {
      const bookingDate =
        text(entry.BookgDt?.Dt) ?? text(entry.ValDt?.Dt) ?? text(entry.BookgDt?.DtTm)?.slice(0, 10)
      if (!bookingDate) throw new Camt054Error('En post saknar bokföringsdatum')
      const entryCredit = text(entry.CdtDbtInd) === 'CRDT'
      const details: Node[] = entry.NtryDtls?.TxDtls ?? []
      const transactions = details.length > 0 ? details : [{}]

      for (const [txIndex, tx] of transactions.entries()) {
        const credit = (text(tx.CdtDbtInd) ?? (entryCredit ? 'CRDT' : 'DBIT')) === 'CRDT'
        if (!credit) {
          skippedDebits++
          continue
        }
        // Batch bookings carry one amount per transaction; a single transaction may rely on the entry.
        const amount =
          amountOf(tx.Amt) ??
          amountOf(tx.AmtDtls?.TxAmt?.Amt) ??
          (transactions.length === 1 ? amountOf(entry.Amt) : null)
        if (!amount) throw new Camt054Error('En betalning saknar belopp')
        if (amount.currency !== 'SEK') {
          skippedOtherCurrency++
          continue
        }

        const reference = remittance(tx)
        const bankRef =
          text(tx.Refs?.AcctSvcrRef) ??
          (transactions.length === 1 ? text(entry.AcctSvcrRef) : null) ??
          text(tx.Refs?.TxId) ??
          text(tx.Refs?.EndToEndId)
        payments.push({
          // Without a bank reference, fall back to the transaction's position and contents.
          bankReference:
            bankRef ?? `${bookingDate}:${entryIndex}:${txIndex}:${amount.ore}:${reference ?? ''}`,
          bookingDate,
          amountOre: amount.ore,
          reference,
          payerName: text(tx.RltdPties?.Dbtr?.Nm) ?? text(tx.RltdPties?.Dbtr?.Pty?.Nm),
        })
      }
    }
  }

  return { messageId: text(root.GrpHdr?.MsgId), payments, skippedDebits, skippedOtherCurrency }
}
