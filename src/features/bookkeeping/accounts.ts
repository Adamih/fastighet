import { Schema } from 'effect'
import type { ChargeKind } from '#/features/agreements/kinds'
import type { LedgerAccount } from '#/features/ledger/kinds'
import { storedJson } from '#/lib/schemas'

// Client-safe: which bookkeeping accounts (kontoplan) the ledger's entries go to in the SIE
// export. Defaults follow BAS; a company can change each number in settings.

export const accountKeys = [
  'receivable',
  'bank',
  'unallocated',
  'outputVat',
  'rent',
  'rentVat',
  'fee',
  'reminderFee',
  'transferFee',
  'pledgeFee',
  'lateInterest',
] as const
export type AccountKey = (typeof accountKeys)[number]

export interface Account {
  readonly number: string
  readonly name: string
}

export type AccountPlan = Record<AccountKey, Account>

/** BAS 2024 accounts; Swedish names, as they are written to the file. */
export const defaultAccounts: AccountPlan = {
  receivable: { number: '1510', name: 'Kundfordringar' },
  bank: { number: '1930', name: 'Företagskonto' },
  unallocated: { number: '2999', name: 'Ej identifierade inbetalningar' },
  outputVat: { number: '2611', name: 'Utgående moms 25 %' },
  rent: { number: '3911', name: 'Hyresintäkter' },
  rentVat: { number: '3913', name: 'Frivilligt momspliktiga hyresintäkter' },
  fee: { number: '3011', name: 'Årsavgifter' },
  reminderFee: { number: '3930', name: 'Påminnelseavgifter' },
  // A BRF's överlåtelse- and pantsättningsavgifter; many keep them on accounts of their own.
  transferFee: { number: '3990', name: 'Övriga ersättningar och intäkter' },
  pledgeFee: { number: '3990', name: 'Övriga ersättningar och intäkter' },
  // Dröjsmålsränta from payers is interest income, not rent (FAR).
  lateInterest: { number: '8313', name: 'Ränteintäkter från kortfristiga fordringar' },
}

/** A BAS account number: four digits. */
export const isAccountNumber = (value: string) => /^\d{4}$/.test(value.trim())

/** The stored numbers: an object, each value checked on its own below. */
const storedAccounts = storedJson(Schema.Record(Schema.String, Schema.Unknown))

/**
 * The company's plan: its own numbers where set, BAS otherwise. Unknown keys, and values that
 * aren't four-digit strings, are ignored.
 */
export function accountPlan(stored: string | null): AccountPlan {
  const custom = storedAccounts(stored) ?? {}
  return Object.fromEntries(
    accountKeys.map((key) => {
      const number = custom[key]
      return [
        key,
        typeof number === 'string' && isAccountNumber(number)
          ? { ...defaultAccounts[key], number: number.trim() }
          : defaultAccounts[key],
      ]
    }),
  ) as AccountPlan
}

/** Which account an entry goes to: by ledger account, and for income by what it is for. */
export function accountFor(
  entry: {
    readonly account: LedgerAccount
    readonly chargeKind: ChargeKind | null
    readonly vatRatePercent: number | null
  },
  plan: AccountPlan,
): Account {
  switch (entry.account) {
    case 'receivable':
      return plan.receivable
    case 'bank':
      return plan.bank
    case 'unallocated':
      return plan.unallocated
    case 'output_vat':
      return plan.outputVat
    case 'income':
      if (entry.chargeKind === 'fee') return plan.fee
      if (entry.chargeKind === 'reminder_fee') return plan.reminderFee
      if (entry.chargeKind === 'transfer_fee') return plan.transferFee
      if (entry.chargeKind === 'pledge_fee') return plan.pledgeFee
      if (entry.chargeKind === 'late_interest') return plan.lateInterest
      return (entry.vatRatePercent ?? 0) > 0 ? plan.rentVat : plan.rent
  }
}
