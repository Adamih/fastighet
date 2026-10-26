import { describe, expect, test } from 'bun:test'
import { accountFor, accountPlan, defaultAccounts } from './accounts'
import { accountTotals, encodePc8, financialYear, sieText, vouchers } from './sie'

const plan = accountPlan(null)
const posting = (
  id: string,
  kind: Parameters<typeof vouchers>[0][number]['kind'],
  date: string,
  entries: [Parameters<typeof accountFor>[0]['account'], number, string | null, number][],
) => ({
  id,
  kind,
  date,
  description: `${kind} ${id}`,
  createdAt: 0,
  entries: entries.map(([account, amountOre, chargeKind, vatRatePercent]) => ({
    account,
    amountOre,
    chargeKind: chargeKind as never,
    vatRatePercent,
  })),
})

const avi = posting('a', 'invoice', '2026-10-12', [
  ['receivable', 1_090_000, null, 0],
  ['income', -1_015_000, 'rent', 0],
  ['income', -60_000, 'parking', 25],
  ['output_vat', -15_000, null, 25],
])
const payment = posting('p', 'payment', '2026-10-30', [
  ['bank', 1_090_000, null, 0],
  ['unallocated', -1_090_000, null, 0],
])
const allocation = posting('m', 'allocation', '2026-10-30', [
  ['unallocated', 1_090_000, null, 0],
  ['receivable', -1_090_000, null, 0],
])
const credit = posting('c', 'credit_note', '2026-11-02', [
  ['receivable', -100_000, null, 0],
  ['income', 100_000, 'rent', 0],
])

describe('accounts', () => {
  test('income goes to rent, rent with VAT, fees or reminder fees', () => {
    expect(
      accountFor({ account: 'income', chargeKind: 'rent', vatRatePercent: 0 }, plan).number,
    ).toBe('3911')
    expect(
      accountFor({ account: 'income', chargeKind: 'parking', vatRatePercent: 25 }, plan).number,
    ).toBe('3913')
    expect(
      accountFor({ account: 'income', chargeKind: 'fee', vatRatePercent: 0 }, plan).number,
    ).toBe('3011')
    expect(
      accountFor({ account: 'income', chargeKind: 'reminder_fee', vatRatePercent: 0 }, plan).number,
    ).toBe('3930')
  })

  test('a company can change account numbers; bad or missing ones fall back to BAS', () => {
    const custom = accountPlan(JSON.stringify({ rent: '3910', bank: 'abc' }))
    expect(custom.rent).toEqual({ number: '3910', name: defaultAccounts.rent.name })
    expect(custom.bank.number).toBe('1930')
    expect(accountPlan('not json').receivable.number).toBe('1510')
  })
})

describe('vouchers', () => {
  const list = vouchers([credit, payment, avi, allocation], plan)

  test('one voucher per posting, numbered per series in date order', () => {
    expect(list.map((v) => `${v.series}${v.number} ${v.date}`)).toEqual([
      'F1 2026-10-12',
      'B1 2026-10-30',
      'B2 2026-10-30',
      'K1 2026-11-02',
    ])
  })

  test('every voucher balances, with rows summed per account', () => {
    for (const v of list) expect(v.rows.reduce((s, r) => s + r.amountOre, 0)).toBe(0)
    expect(list[0].rows.map((r) => [r.account.number, r.amountOre])).toEqual([
      ['1510', 1_090_000],
      ['3911', -1_015_000],
      ['3913', -60_000],
      ['2611', -15_000],
    ])
  })

  test('totals per account', () => {
    const receivable = accountTotals(list).find((t) => t.account.number === '1510')
    expect(receivable).toMatchObject({ debitOre: 1_090_000, creditOre: 1_190_000 })
  })
})

describe('file', () => {
  const text = sieText(
    {
      companyName: 'Exempel "Fastigheter" AB',
      organizationNumber: '559900-0006',
      generatedOn: '2026-11-05',
      financialYear: { start: '2026-01-01', end: '2026-12-31' },
    },
    vouchers([avi], plan),
  )

  test('has the SIE 4 header, the accounts used and the vouchers, with CRLF', () => {
    const lines = text.split('\r\n')
    expect(lines.slice(0, 11)).toEqual([
      '#FLAGGA 0',
      '#PROGRAM "Fastighet" "1.0"',
      '#FORMAT PC8',
      '#GEN 20261105',
      '#SIETYP 4',
      '#FNAMN "Exempel \\"Fastigheter\\" AB"',
      '#ORGNR 559900-0006',
      '#RAR 0 20260101 20261231',
      '#KPTYP BAS2024',
      '#VALUTA SEK',
      '#KONTO 1510 "Kundfordringar"',
    ])
    expect(text).toContain(
      '#VER "F" "1" 20261012 "invoice a"\r\n{\r\n   #TRANS 1510 {} 10900.00\r\n',
    )
    expect(text).toContain('   #TRANS 3913 {} -600.00\r\n')
    expect(text.endsWith('}\r\n')).toBe(true)
  })

  test('is encoded as PC8 (codepage 437)', () => {
    expect([...encodePc8('ÅÄÖåäöé')]).toEqual([0x8f, 0x8e, 0x99, 0x86, 0x84, 0x94, 0x82])
    expect([...encodePc8('A€')]).toEqual([0x41, 0x3f])
  })
})

test('the financial year containing a date', () => {
  expect(financialYear('2026-10-15', 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  expect(financialYear('2026-03-15', 7)).toEqual({ start: '2025-07-01', end: '2026-06-30' })
  expect(financialYear('2026-09-15', 7)).toEqual({ start: '2026-07-01', end: '2027-06-30' })
})
