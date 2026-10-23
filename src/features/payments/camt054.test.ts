/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { Camt054Error, parseCamt054 } from './camt054'
import { buildCamt054 } from './camt054-builder'

describe('parseCamt054', () => {
  test('reads batch bookings with OCR references', () => {
    const xml = buildCamt054({
      messageId: 'MSG-1',
      bankgiro: '990-0002',
      payments: [
        {
          bookingDate: '2026-11-30',
          amountOre: 845000,
          ocr: '18',
          payerName: 'Anna Svensson',
          bankReference: 'BG-1',
        },
        {
          bookingDate: '2026-11-30',
          amountOre: 3750000,
          ocr: '26',
          payerName: 'Kaffe & Kaka AB',
          bankReference: 'BG-2',
        },
        {
          bookingDate: '2026-12-01',
          amountOre: 50050,
          freeText: 'Hyra P1 november',
          bankReference: 'BG-3',
        },
      ],
    })
    const parsed = parseCamt054(xml)
    expect(parsed.messageId).toBe('MSG-1')
    expect(parsed.payments).toEqual([
      {
        bankReference: 'BG-1',
        bookingDate: '2026-11-30',
        amountOre: 845000,
        reference: '18',
        payerName: 'Anna Svensson',
      },
      {
        bankReference: 'BG-2',
        bookingDate: '2026-11-30',
        amountOre: 3750000,
        reference: '26',
        payerName: 'Kaffe & Kaka AB',
      },
      {
        bankReference: 'BG-3',
        bookingDate: '2026-12-01',
        amountOre: 50050,
        reference: 'Hyra P1 november',
        payerName: null,
      },
    ])
  })

  test('skips debits and other currencies, and counts them', () => {
    const xml = buildCamt054({
      messageId: 'MSG-2',
      bankgiro: '990-0002',
      payments: [
        { bookingDate: '2026-11-30', amountOre: 1000, bankReference: 'D', debit: true },
        { bookingDate: '2026-11-30', amountOre: 1000, bankReference: 'E', currency: 'EUR' },
        { bookingDate: '2026-11-30', amountOre: 1000, bankReference: 'S', ocr: '18' },
      ],
    })
    const parsed = parseCamt054(xml)
    expect(parsed.payments.map((p) => p.bankReference)).toEqual(['S'])
    expect(parsed.skippedDebits).toBe(1)
    expect(parsed.skippedOtherCurrency).toBe(1)
  })

  test('handles a single transaction without its own amount, OCR in free text, prefixed namespace', () => {
    const xml = `<?xml version="1.0"?>
<ns:Document xmlns:ns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08">
  <ns:BkToCstmrDbtCdtNtfctn>
    <ns:GrpHdr><ns:MsgId>X</ns:MsgId></ns:GrpHdr>
    <ns:Ntfctn>
      <ns:Ntry>
        <ns:Amt Ccy="SEK">8 450,00</ns:Amt>
        <ns:CdtDbtInd>CRDT</ns:CdtDbtInd>
        <ns:BookgDt><ns:Dt>2026-11-27</ns:Dt></ns:BookgDt>
        <ns:AcctSvcrRef>ENTRY-REF</ns:AcctSvcrRef>
        <ns:NtryDtls><ns:TxDtls>
          <ns:RmtInf><ns:Ustrd>Hyra</ns:Ustrd><ns:Ustrd>1 8</ns:Ustrd></ns:RmtInf>
        </ns:TxDtls></ns:NtryDtls>
      </ns:Ntry>
      <ns:Ntry>
        <ns:Amt Ccy="SEK">100.00</ns:Amt>
        <ns:CdtDbtInd>CRDT</ns:CdtDbtInd>
        <ns:ValDt><ns:Dt>2026-11-28</ns:Dt></ns:ValDt>
      </ns:Ntry>
    </ns:Ntfctn>
  </ns:BkToCstmrDbtCdtNtfctn>
</ns:Document>`
    const parsed = parseCamt054(xml)
    expect(parsed.payments[0]).toEqual({
      bankReference: 'ENTRY-REF',
      bookingDate: '2026-11-27',
      amountOre: 845000,
      reference: '18',
      payerName: null,
    })
    // No details and no bank reference: still imported, with a positional reference.
    expect(parsed.payments[1].amountOre).toBe(10000)
    expect(parsed.payments[1].bankReference).toBe('2026-11-28:1:0:10000:')
  })

  test('rejects files that are not camt.054', () => {
    expect(() => parseCamt054('<not xml')).toThrow(Camt054Error)
    expect(() => parseCamt054('<Document><Other/></Document>')).toThrow('inte en camt.054')
  })
})
