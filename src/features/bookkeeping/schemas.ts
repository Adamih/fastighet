import { Schema } from 'effect'
import { IsoDate } from '#/lib/schemas'
import { accountKeys, isAccountNumber } from './accounts'

/** A period to export, both days included. */
export const ExportPeriodInput = Schema.Struct({ fromDate: IsoDate, toDate: IsoDate })
export type ExportPeriodInput = typeof ExportPeriodInput.Type

const AccountNumber = Schema.String.check(
  Schema.makeFilter(isAccountNumber, { message: 'Ange ett kontonummer med fyra siffror' }),
)

export const UpdateBookkeepingSettingsInput = Schema.Struct({
  /** "1" to "12", as the form's select holds it. */
  financialYearStartMonth: Schema.String.check(
    Schema.makeFilter((v: string) => /^(?:[1-9]|1[0-2])$/.test(v), {
      message: 'Välj en månad',
    }),
  ),
  accounts: Schema.Struct(
    Object.fromEntries(accountKeys.map((k) => [k, AccountNumber])) as Record<
      (typeof accountKeys)[number],
      typeof AccountNumber
    >,
  ),
})
export type UpdateBookkeepingSettingsInput = typeof UpdateBookkeepingSettingsInput.Type
