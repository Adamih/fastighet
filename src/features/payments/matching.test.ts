/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import type { ParsedPayment } from './camt054'
import { allocate, allocationSummary, matchPayments, type OpenAvi } from './matching'

const avi = (number: number, dueDate: string, owedOre: number): OpenAvi => ({
  id: `inv-${number}`,
  number,
  dueDate,
  owedOre,
})
const oct = avi(1, '2026-09-30', 845_000)
const nov = avi(2, '2026-10-30', 845_000)
const payment = (amountOre: number, reference: string | null): ParsedPayment => ({
  bankReference: `ref-${amountOre}-${reference}`,
  bookingDate: '2026-11-05',
  amountOre,
  reference,
  payerName: null,
})

describe('allocate', () => {
  test('the named avi first, then the oldest, then credit', () => {
    expect(allocate(845_000, [oct, nov], nov.id)).toEqual([
      { invoiceId: nov.id, amountOre: 845_000 },
    ])
    expect(allocate(1_690_000, [nov, oct], nov.id)).toEqual([
      { invoiceId: nov.id, amountOre: 845_000 },
      { invoiceId: oct.id, amountOre: 845_000 },
    ])
    expect(allocate(1_000_000, [nov, oct])).toEqual([
      { invoiceId: oct.id, amountOre: 845_000 },
      { invoiceId: nov.id, amountOre: 155_000 },
    ])
    expect(allocate(900_000, [oct], oct.id)).toEqual([
      { invoiceId: oct.id, amountOre: 845_000 },
      { invoiceId: null, amountOre: 55_000 },
    ])
  })

  test('a part payment lowers what the avi owes; with nothing open it is all credit', () => {
    expect(allocate(400_000, [oct], oct.id)).toEqual([{ invoiceId: oct.id, amountOre: 400_000 }])
    expect(allocate(50_000, [])).toEqual([{ invoiceId: null, amountOre: 50_000 }])
  })
})

describe('matchPayments', () => {
  const byOcr = new Map([
    ['18', { id: oct.id, partyId: 'anna' }],
    ['26', { id: nov.id, partyId: 'anna' }],
    ['34', { id: 'inv-paid', partyId: 'anna' }],
  ])
  const open = new Map([['anna', [oct, nov]]])

  test('an OCR names the party; the amount is split by the rule', () => {
    const [both] = matchPayments([payment(1_690_000, '1 8')], byOcr, open)
    expect(both).toEqual({
      status: 'matched',
      partyId: 'anna',
      allocations: [
        { invoiceId: oct.id, amountOre: 845_000 },
        { invoiceId: nov.id, amountOre: 845_000 },
      ],
    })
  })

  test("an old avi's OCR still finds the party's oldest open avi", () => {
    const [result] = matchPayments([payment(845_000, '34')], byOcr, open)
    expect(result.allocations).toEqual([{ invoiceId: oct.id, amountOre: 845_000 }])
  })

  test('two payments for one avi in a file: the second goes on', () => {
    const [first, second] = matchPayments(
      [payment(845_000, '18'), payment(845_000, '18')],
      byOcr,
      open,
    )
    expect(first.allocations).toEqual([{ invoiceId: oct.id, amountOre: 845_000 }])
    expect(second.allocations).toEqual([{ invoiceId: nov.id, amountOre: 845_000 }])
  })

  test('unknown or missing OCR waits for a person', () => {
    const results = matchPayments(
      [payment(100, '99'), payment(100, null), payment(100, 'Hyra')],
      byOcr,
      open,
    )
    expect(results.map((r) => r.status)).toEqual(['unmatched', 'unmatched', 'unmatched'])
  })
})

test('where a payment went, in words', () => {
  const nbsp = (s: string) => s.replace(/\s/g, ' ')
  expect(
    allocationSummary([
      { invoiceId: 'a', amountOre: 1, number: 1042 },
      { invoiceId: 'b', amountOre: 1, number: 1043 },
    ]),
  ).toBe('Betalade avi 1042 och 1043')
  expect(
    nbsp(
      allocationSummary([
        { invoiceId: 'a', amountOre: 800_000, number: 1042 },
        { invoiceId: null, amountOre: 50_000 },
      ]),
    ),
  ).toBe('8 000,00 kr på avi 1042, 500,00 kr tillgodo')
  expect(allocationSummary([{ invoiceId: null, amountOre: 50_000 }])).toBe('Tillgodo')
})
