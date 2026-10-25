import { describe, expect, test } from 'bun:test'
import {
  type CreditableInvoice,
  draftCreditNote,
  owedOrTotal,
  remainingOre,
  vatRateOf,
} from './credit'

const rent: CreditableInvoice = {
  number: 7,
  totalOre: 845_000,
  creditedOre: 0,
  voidedAt: null,
  lines: [
    {
      description: 'Hyra Uppsala Kungsängen 12:3 · 1001, oktober 2026',
      netOre: 845_000,
      vatRatePercent: 0,
      vatOre: 0,
    },
  ],
}
const commercial: CreditableInvoice = {
  number: 8,
  totalOre: 5_625_000,
  creditedOre: 0,
  voidedAt: null,
  lines: [
    { description: 'Hyra lokal, Q4', netOre: 4_500_000, vatRatePercent: 25, vatOre: 1_125_000 },
  ],
}

test('remainingOre and vatRateOf', () => {
  expect(remainingOre({ totalOre: 100, creditedOre: 30 })).toBe(70)
  expect(remainingOre({ totalOre: 100, creditedOre: 130 })).toBe(0)
  expect(vatRateOf(commercial)).toBe(25)
  expect(vatRateOf(rent)).toBe(0)
})

describe('draftCreditNote', () => {
  test('crediting an untouched invoice in full repeats its lines', () => {
    const result = draftCreditNote(commercial, { kind: 'rest' })
    expect(result).toEqual({
      ok: true,
      draft: {
        lines: commercial.lines.map((l) => ({ ...l })),
        netOre: 4_500_000,
        vatOre: 1_125_000,
        totalOre: 5_625_000,
      },
    })
  })

  test('a part, given excluding VAT, gets VAT at the invoice rate', () => {
    const result = draftCreditNote(commercial, { kind: 'amount', netOre: 100_000 })
    expect(result).toEqual({
      ok: true,
      draft: {
        lines: [
          {
            description: 'Kreditering, avi 8',
            netOre: 100_000,
            vatRatePercent: 25,
            vatOre: 25_000,
          },
        ],
        netOre: 100_000,
        vatOre: 25_000,
        totalOre: 125_000,
      },
    })
  })

  test('the rest after a partial credit is one line, split back into net and VAT', () => {
    const result = draftCreditNote({ ...commercial, creditedOre: 125_000 }, { kind: 'rest' })
    expect(result.ok && result.draft).toMatchObject({
      netOre: 4_400_000,
      vatOre: 1_100_000,
      totalOre: 5_500_000,
    })
    expect(result.ok && result.draft.lines[0].description).toBe(
      'Kreditering av resterande belopp, avi 8',
    )
  })

  test('rounding of the rest stays within the remaining amount', () => {
    const odd = { ...commercial, totalOre: 1_001, creditedOre: 0, lines: [] }
    const result = draftCreditNote({ ...odd, creditedOre: 1 }, { kind: 'rest' })
    expect(result.ok && result.draft.totalOre).toBe(1_000)
  })

  test('refuses what cannot be credited', () => {
    expect(draftCreditNote({ ...rent, voidedAt: new Date() }, { kind: 'rest' })).toEqual({
      ok: false,
      problem: 'void',
    })
    expect(draftCreditNote({ ...rent, creditedOre: 845_000 }, { kind: 'rest' })).toEqual({
      ok: false,
      problem: 'nothing_left',
    })
    expect(draftCreditNote(rent, { kind: 'amount', netOre: 0 })).toEqual({
      ok: false,
      problem: 'not_positive',
    })
    expect(draftCreditNote(rent, { kind: 'amount', netOre: 845_001 })).toEqual({
      ok: false,
      problem: 'too_much',
    })
    expect(
      draftCreditNote(
        { ...commercial, creditedOre: 5_000_000 },
        { kind: 'amount', netOre: 500_001 },
      ),
    ).toEqual({ ok: false, problem: 'too_much' })
  })
})

test('lists show what is still owed on open invoices and the total on the rest', () => {
  const credited = { totalOre: 845000, creditedOre: 200000 }
  expect(owedOrTotal({ ...credited, status: 'overdue' })).toBe(645000)
  expect(owedOrTotal({ ...credited, status: 'unpaid' })).toBe(645000)
  expect(owedOrTotal({ ...credited, status: 'paid' })).toBe(845000)
})
