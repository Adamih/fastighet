/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import type { ParsedPayment } from './camt054'
import { type InvoiceForMatching, matchPayments } from './matching'

const invoice = (
  number: number,
  ocr: string,
  totalOre: number,
  extra: Partial<InvoiceForMatching> = {},
): InvoiceForMatching => ({
  id: `inv-${number}`,
  number,
  ocr,
  totalOre,
  paidOn: null,
  voided: false,
  ...extra,
})
const byOcr = (...invoices: InvoiceForMatching[]) => new Map(invoices.map((i) => [i.ocr, i]))
const payment = (amountOre: number, reference: string | null): ParsedPayment => ({
  bankReference: `ref-${amountOre}-${reference}`,
  bookingDate: '2026-11-30',
  amountOre,
  reference,
  payerName: null,
})

describe('matchPayments', () => {
  test('exact OCR and amount marks the invoice paid', () => {
    expect(matchPayments([payment(845000, '18')], byOcr(invoice(1, '18', 845000)))).toEqual([
      { status: 'matched', invoiceId: 'inv-1', marksInvoicePaid: true, note: null },
    ])
  })

  test('OCR with spaces still matches', () => {
    expect(matchPayments([payment(845000, '1 8')], byOcr(invoice(1, '18', 845000)))[0].status).toBe(
      'matched',
    )
  })

  test('unknown or missing OCR is unmatched', () => {
    const results = matchPayments(
      [payment(100, '99'), payment(100, null), payment(100, 'Hyra')],
      byOcr(invoice(1, '18', 100)),
    )
    expect(results.map((r) => r.status)).toEqual(['unmatched', 'unmatched', 'unmatched'])
  })

  test('wrong amount goes to review with the likely invoice', () => {
    const [short, over] = matchPayments(
      [payment(800000, '18'), payment(900000, '26')],
      byOcr(invoice(1, '18', 845000), invoice(2, '26', 845000)),
    )
    expect(short).toMatchObject({ status: 'review', invoiceId: 'inv-1', marksInvoicePaid: false })
    expect(short.note?.replace(/\s/g, ' ')).toBe(
      'Delbetalning: 8 000,00 kr av 8 450,00 kr på avi 1',
    )
    expect(over.note).toStartWith('Överbetalning')
  })

  test('paid, voided and doubly paid invoices go to review', () => {
    const results = matchPayments(
      [payment(100, '18'), payment(100, '26'), payment(100, '34'), payment(100, '34')],
      byOcr(
        invoice(1, '18', 100, { paidOn: '2026-11-01' }),
        invoice(2, '26', 100, { voided: true }),
        invoice(3, '34', 100),
      ),
    )
    expect(results.map((r) => r.status)).toEqual(['review', 'review', 'matched', 'review'])
    expect(results[0].note).toContain('redan betald')
    expect(results[1].note).toContain('makulerad')
    expect(results[3].note).toContain('två gånger')
  })
})
