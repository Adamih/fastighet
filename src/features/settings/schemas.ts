import { Schema } from 'effect'
import { isValidBankgiro } from '#/features/invoicing/rules'
import { type BrfFeeKind, feePercentProblem } from '#/features/ownerships/fees'
import { MAX_REMINDER_FEE_ORE } from '#/features/reminders/rules'
import { isValidOrganizationNumber } from '#/features/tenants/organization-number'
import { parseSek } from '#/lib/money'
import { Email, OptionalText, PostalCode } from '#/lib/schemas'
import { companyKinds } from './company-kinds'

/** A BRF fee as a percent of the prisbasbelopp, as typed; blank means it isn't charged. */
const FeePercent = (kind: BrfFeeKind, message: string) =>
  Schema.String.check(
    Schema.makeFilter((s: string) => feePercentProblem(kind, s) === null, { message }),
  )

export const UpdateCompanyDetailsInput = Schema.Struct({
  organizationNumber: Schema.String.check(
    Schema.makeFilter((s: string) => s.trim() === '' || isValidOrganizationNumber(s), {
      message: 'Ogiltigt organisationsnummer',
    }),
  ),
  bankgiro: Schema.String.check(
    Schema.makeFilter((s: string) => s.trim() === '' || isValidBankgiro(s), {
      message: 'Ogiltigt bankgironummer',
    }),
  ),
  streetAddress: OptionalText,
  postalCode: PostalCode,
  city: OptionalText,
  email: Email,
  phone: OptionalText,
  fSkatt: Schema.Boolean,
  kind: Schema.Literals(companyKinds),
  /** Kronor as typed; blank means no reminder fee is agreed. */
  reminderFee: Schema.String.check(
    Schema.makeFilter(
      (s: string) => {
        if (!s.trim()) return true
        const ore = parseSek(s)
        return ore !== null && ore > 0 && ore <= MAX_REMINDER_FEE_ORE
      },
      { message: 'Ange högst 60 kr, eller lämna tomt för ingen avgift' },
    ),
  ),
  reminderIntervalDays: Schema.String.check(
    Schema.makeFilter((s: string) => /^\d+$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 90, {
      message: 'Ange 1–90 dagar',
    }),
  ),
  reminderDueDays: Schema.String.check(
    Schema.makeFilter((s: string) => /^\d+$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 60, {
      message: 'Ange 1–60 dagar',
    }),
  ),
  waiveReminderFeeByDueDate: Schema.Boolean,
  portalContactEdits: Schema.Boolean,
  portalContactEmail: Email,
  portalContactPhone: OptionalText,
  lateInterest: Schema.Boolean,
  /** Kronor as typed; blank charges any interest of at least 1 kr. */
  lateInterestMinimum: Schema.String.check(
    Schema.makeFilter(
      (s: string) => {
        if (!s.trim()) return true
        const ore = parseSek(s)
        return ore !== null && ore >= 0 && ore <= 100_000
      },
      { message: 'Ange högst 1 000 kr, eller lämna tomt' },
    ),
  ),
  pledgeFee: FeePercent('pledge_fee', 'Ange högst 1 % av prisbasbeloppet, eller lämna tomt'),
  transferFee: FeePercent('transfer_fee', 'Ange högst 2,5 % av prisbasbeloppet, eller lämna tomt'),
})
export type UpdateCompanyDetailsInput = typeof UpdateCompanyDetailsInput.Type

export const SetCompanyKindInput = Schema.Struct({ kind: Schema.Literals(companyKinds) })
