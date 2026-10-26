import type { ChargeKind } from '#/features/agreements/kinds'
import type { LedgerAccount, PostingKind } from '#/features/ledger/kinds'
import { type Account, type AccountPlan, accountFor } from './accounts'

// Pure rules for the SIE export (type 4, vouchers only, the kind an invoicing program hands to
// an accounting program for import). Postings become vouchers (verifikationer); the file is
// text in PC8 (codepage 437) with CRLF line endings. Unit-tested.

export interface SiePosting {
  readonly id: string
  readonly date: string
  readonly kind: PostingKind
  readonly description: string
  /** Milliseconds; orders postings written on the same day. */
  readonly createdAt: number
  readonly entries: readonly {
    readonly account: LedgerAccount
    readonly amountOre: number
    readonly chargeKind: ChargeKind | null
    readonly vatRatePercent: number | null
  }[]
}

/** Voucher series: F avier (and their voids and reminder fees), K credit notes, B payments. */
export type Series = 'F' | 'K' | 'B'

export const seriesOf = (kind: PostingKind): Series =>
  kind === 'credit_note'
    ? 'K'
    : kind === 'invoice' || kind === 'void' || kind === 'reminder'
      ? 'F'
      : 'B'

export interface Voucher {
  readonly series: Series
  readonly number: number
  readonly date: string
  readonly text: string
  readonly rows: readonly { readonly account: Account; readonly amountOre: number }[]
}

/**
 * The vouchers for the postings: one each, numbered per series in date order (then by when
 * they were written), so the same postings always give the same file. A voucher's rows are
 * summed per account; accounts that net to zero are left out.
 */
export function vouchers(postings: readonly SiePosting[], plan: AccountPlan): Voucher[] {
  const ordered = [...postings].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )
  const counters: Record<Series, number> = { F: 0, K: 0, B: 0 }
  return ordered.flatMap((posting) => {
    const sums = new Map<string, { account: Account; amountOre: number }>()
    for (const entry of posting.entries) {
      const account = accountFor(entry, plan)
      const row = sums.get(account.number) ?? { account, amountOre: 0 }
      row.amountOre += entry.amountOre
      sums.set(account.number, row)
    }
    const rows = [...sums.values()].filter((r) => r.amountOre !== 0)
    if (rows.length === 0) return []
    const series = seriesOf(posting.kind)
    counters[series] += 1
    return [
      { series, number: counters[series], date: posting.date, text: posting.description, rows },
    ]
  })
}

/** Debit and credit per account over the vouchers, by account number. */
export function accountTotals(list: readonly Voucher[]) {
  const totals = new Map<string, { account: Account; debitOre: number; creditOre: number }>()
  for (const voucher of list) {
    for (const row of voucher.rows) {
      const total = totals.get(row.account.number) ?? {
        account: row.account,
        debitOre: 0,
        creditOre: 0,
      }
      if (row.amountOre > 0) total.debitOre += row.amountOre
      else total.creditOre -= row.amountOre
      totals.set(row.account.number, total)
    }
  }
  return [...totals.values()].sort((a, b) => a.account.number.localeCompare(b.account.number))
}

/** "20261026" */
const sieDate = (date: string) => date.replaceAll('-', '')
/** A quoted SIE string. */
const quoted = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
/** Kronor with two decimals and a decimal point; credits negative. */
const amount = (ore: number) => {
  const sign = ore < 0 ? '-' : ''
  const abs = Math.abs(ore)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** The financial year containing `date`, given the month it starts in (1 = January). */
export function financialYear(date: string, startMonth: number) {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const startYear = month >= startMonth ? year : year - 1
  const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`
  const endYear = startMonth === 1 ? startYear : startYear + 1
  const endMonth = startMonth === 1 ? 12 : startMonth - 1
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate()
  const end = `${endYear}-${String(endMonth).padStart(2, '0')}-${lastDay}`
  return { start, end }
}

/** The SIE file's text: header, the accounts used, then the vouchers. Lines end in CRLF. */
export function sieText(
  meta: {
    readonly companyName: string
    readonly organizationNumber: string | null
    readonly generatedOn: string
    readonly financialYear: { start: string; end: string }
  },
  list: readonly Voucher[],
): string {
  const accounts = accountTotals(list).map((t) => t.account)
  const lines = [
    '#FLAGGA 0',
    `#PROGRAM ${quoted('Fastighet')} ${quoted('1.0')}`,
    '#FORMAT PC8',
    `#GEN ${sieDate(meta.generatedOn)}`,
    '#SIETYP 4',
    `#FNAMN ${quoted(meta.companyName)}`,
    ...(meta.organizationNumber ? [`#ORGNR ${meta.organizationNumber}`] : []),
    `#RAR 0 ${sieDate(meta.financialYear.start)} ${sieDate(meta.financialYear.end)}`,
    '#KPTYP BAS2024',
    '#VALUTA SEK',
    ...accounts.map((a) => `#KONTO ${a.number} ${quoted(a.name)}`),
    ...list.flatMap((v) => [
      `#VER ${quoted(v.series)} ${quoted(String(v.number))} ${sieDate(v.date)} ${quoted(v.text)}`,
      '{',
      ...v.rows.map((r) => `   #TRANS ${r.account.number} {} ${amount(r.amountOre)}`),
      '}',
    ]),
  ]
  return `${lines.join('\r\n')}\r\n`
}

/** Codepage 437, bytes 0x80–0xFF; SIE's PC8. */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

/** Encodes text as PC8. Characters it can't represent become "?". */
export function encodePc8(text: string): Uint8Array {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63
    if (code < 0x80) bytes.push(code)
    else {
      const index = CP437_HIGH.indexOf(char)
      bytes.push(index >= 0 ? 0x80 + index : 63)
    }
  }
  return Uint8Array.from(bytes)
}
