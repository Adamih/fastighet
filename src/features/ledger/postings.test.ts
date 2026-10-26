import { describe, expect, test } from 'bun:test'
import {
  allocationEntries,
  creditAllocationEntries,
  creditBalance,
  creditNoteEntries,
  creditTransferEntries,
  creditUseEntries,
  invoiceEntries,
  invoiceMoney,
  manualPaymentEntries,
  paymentEntries,
  type ReceivableEntry,
  refundEntries,
  reminderFeeEntries,
  reversal,
  statusFromMoney,
} from './postings'

const avi = {
  id: 'i1',
  totalOre: 1_090_000,
  vatOre: 15_000,
  lines: [
    { kind: 'rent' as const, netOre: 1_015_000, vatRatePercent: 0, vatOre: 0 },
    { kind: 'parking' as const, netOre: 60_000, vatRatePercent: 25, vatOre: 15_000 },
  ],
}
const sum = (entries: { amountOre: number }[]) => entries.reduce((s, e) => s + e.amountOre, 0)

describe('postings', () => {
  test('an avi posts the receivable against income per line and VAT per rate', () => {
    const entries = invoiceEntries(avi)
    expect(sum(entries)).toBe(0)
    expect(entries.map((e) => [e.account, e.amountOre, e.chargeKind ?? null])).toEqual([
      ['receivable', 1_090_000, null],
      ['income', -1_015_000, 'rent'],
      ['income', -60_000, 'parking'],
      ['output_vat', -15_000, null],
    ])
  })

  test('every other event balances too, and a reversal undoes it', () => {
    for (const entries of [
      creditNoteEntries('i1', avi),
      paymentEntries('p1', 500_000),
      allocationEntries('p1', 'i1', 500_000),
      manualPaymentEntries('i1', 500_000),
      refundEntries(100_000),
      creditAllocationEntries('p1', 50_000),
      creditUseEntries('i1', 50_000),
      creditTransferEntries('i1', 50_000),
      reminderFeeEntries('i1', 6_000),
    ]) {
      expect(sum(entries)).toBe(0)
      expect(sum([...entries, ...reversal(entries)])).toBe(0)
    }
  })
})

describe('invoice money', () => {
  const e = (kind: ReceivableEntry['kind'], amountOre: number, date = '2026-10-01') => ({
    kind,
    amountOre,
    date,
  })
  const today = '2026-11-15'
  const due = { voidedAt: null, dueDate: '2026-10-30' }

  test('unpaid, then part paid, then paid in two payments', () => {
    const issued = [e('invoice', 900_000)]
    expect(statusFromMoney(due, invoiceMoney(issued), today)).toBe('overdue')
    const part = [...issued, e('allocation', -400_000, '2026-10-28')]
    expect(invoiceMoney(part)).toMatchObject({ owedOre: 500_000, paidOre: 400_000, paidOn: null })
    const paid = [...part, e('allocation', -500_000, '2026-11-05')]
    expect(invoiceMoney(paid)).toMatchObject({ owedOre: 0, paidOn: '2026-11-05' })
    expect(statusFromMoney(due, invoiceMoney(paid), today)).toBe('paid')
  })

  test('credited in full before payment, or credited after payment into the credit balance', () => {
    const credited = [e('invoice', 900_000), e('credit_note', -900_000)]
    expect(statusFromMoney(due, invoiceMoney(credited), today)).toBe('credited')
    const overpaid = [
      e('invoice', 900_000),
      e('manual_payment', -900_000),
      e('credit_note', -100_000),
      e('credit_transfer', 100_000),
    ]
    expect(invoiceMoney(overpaid)).toMatchObject({ owedOre: 0, toCreditOre: 100_000 })
    expect(statusFromMoney(due, invoiceMoney(overpaid), today)).toBe('paid')
  })

  test('credit used on an avi pays it like a payment', () => {
    const withCredit = [e('invoice', 900_000), e('credit_use', -50_000)]
    expect(invoiceMoney(withCredit)).toMatchObject({ owedOre: 850_000, creditUsedOre: 50_000 })
    const settled = [e('invoice', 50_000), e('credit_use', -50_000, '2026-10-02')]
    expect(invoiceMoney(settled)).toMatchObject({ paidOre: 0, paidOn: '2026-10-02' })
    expect(statusFromMoney(due, invoiceMoney(settled), today)).toBe('paid')
  })

  test("a party's credit balance is what their entries without an avi add up to", () => {
    const entries = [
      ...creditAllocationEntries('p1', 50_000),
      ...creditUseEntries('i1', 20_000),
    ].filter((x) => x.account === 'receivable' && !x.invoiceId)
    expect(creditBalance(entries)).toBe(30_000)
  })

  test('a voided avi is void whatever it owes', () => {
    const voided = { voidedAt: new Date(0), dueDate: '2026-10-30' }
    expect(statusFromMoney(voided, invoiceMoney([e('invoice', 900_000)]), today)).toBe('void')
  })

  test('a reminder fee is owed on top, and keeps the avi overdue until paid', () => {
    const reminded = [e('invoice', 900_000), e('reminder', 6_000), e('allocation', -900_000)]
    expect(invoiceMoney(reminded)).toMatchObject({ owedOre: 6_000, paidOre: 900_000 })
    expect(statusFromMoney(due, invoiceMoney(reminded), today)).toBe('overdue')
  })

  test('an undone payment reopens the avi', () => {
    const undone = [e('invoice', 900_000), e('allocation', -900_000), e('allocation', 900_000)]
    expect(invoiceMoney(undone)).toMatchObject({ owedOre: 900_000, paidOre: 0, paidOn: null })
    expect(statusFromMoney({ ...due, dueDate: '2026-12-30' }, invoiceMoney(undone), today)).toBe(
      'unpaid',
    )
  })
})
