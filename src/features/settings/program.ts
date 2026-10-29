import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { organizationSettings, priceBaseAmount } from '#/db/schema'
import { formatBankgiro } from '#/features/invoicing/rules'
import { parseFeePercent } from '#/features/ownerships/fees'
import {
  DEFAULT_REMINDER_DUE_DAYS,
  DEFAULT_REMINDER_INTERVAL_DAYS,
} from '#/features/reminders/rules'
import { formatOrganizationNumber } from '#/features/tenants/organization-number'
import { parseSek } from '#/lib/money'
import { blankToNull } from '#/lib/schemas'
import { requirePermission } from '#/server/authorize'
import { orgQuery, query } from '#/server/scoped'
import { CurrentOrganization } from '#/server/services'
import type { CompanyKind } from './company-kinds'
import type { UpdateCompanyDetailsInput } from './schemas'

/**
 * The seller details, without a permission check: invoices print them for anyone who may work
 * with invoices. The Företagsuppgifter page itself goes through `getCompanyDetails`.
 */
export const loadCompanyDetails = Effect.gen(function* () {
  const organization = yield* CurrentOrganization
  const row = yield* orgQuery((db, organizationId) =>
    db.query.organizationSettings.findFirst({
      where: eq(organizationSettings.organizationId, organizationId),
    }),
  )
  return {
    organizationName: organization.name,
    organizationNumber: row?.organizationNumber ?? null,
    bankgiro: row?.bankgiro ?? null,
    streetAddress: row?.streetAddress ?? null,
    postalCode: row?.postalCode ?? null,
    city: row?.city ?? null,
    email: row?.email ?? null,
    phone: row?.phone ?? null,
    fSkatt: row?.fSkatt ?? true,
    kind: row?.kind ?? 'landlord',
    reminderFeeOre: row?.reminderFeeOre ?? null,
    reminderIntervalDays: row?.reminderIntervalDays ?? DEFAULT_REMINDER_INTERVAL_DAYS,
    reminderDueDays: row?.reminderDueDays ?? DEFAULT_REMINDER_DUE_DAYS,
    waiveReminderFeeByDueDate: row?.waiveReminderFeeByDueDate ?? false,
    pledgeFeeBasisPoints: row?.pledgeFeeBasisPoints ?? null,
    transferFeeBasisPoints: row?.transferFeeBasisPoints ?? null,
  }
})

export type CompanyDetails = Effect.Success<typeof loadCompanyDetails>

/**
 * What a BRF charges for pledges and sales (null: not charged) and the prisbasbelopp by year,
 * without a permission check: the pledge and sale flows use it under their own.
 */
export const loadFeeTerms = Effect.gen(function* () {
  const settings = yield* loadCompanyDetails
  const amounts = yield* query((db) => db.select().from(priceBaseAmount))
  return {
    pledgeFeeBasisPoints: settings.pledgeFeeBasisPoints,
    transferFeeBasisPoints: settings.transferFeeBasisPoints,
    priceBaseAmounts: Object.fromEntries(amounts.map((a) => [a.year, a.amountKr])) as Record<
      number,
      number
    >,
  }
})

export type FeeTerms = Effect.Success<typeof loadFeeTerms>

export const getCompanyDetails = requirePermission({ settings: ['read'] }).pipe(
  Effect.andThen(loadCompanyDetails),
)

export const updateCompanyDetails = (input: UpdateCompanyDetailsInput) =>
  Effect.gen(function* () {
    yield* requirePermission({ settings: ['manage'] })
    const values = {
      organizationNumber: input.organizationNumber.trim()
        ? formatOrganizationNumber(input.organizationNumber)
        : null,
      bankgiro: input.bankgiro.trim() ? formatBankgiro(input.bankgiro) : null,
      streetAddress: blankToNull(input.streetAddress),
      postalCode: blankToNull(input.postalCode.replace(/\s/g, '')),
      city: blankToNull(input.city),
      email: blankToNull(input.email),
      phone: blankToNull(input.phone),
      fSkatt: input.fSkatt,
      kind: input.kind,
      reminderFeeOre: input.reminderFee.trim() ? parseSek(input.reminderFee) : null,
      reminderIntervalDays: Number(input.reminderIntervalDays),
      reminderDueDays: Number(input.reminderDueDays),
      waiveReminderFeeByDueDate: input.waiveReminderFeeByDueDate,
      pledgeFeeBasisPoints: parseFeePercent(input.pledgeFee),
      transferFeeBasisPoints: parseFeePercent(input.transferFee),
    }
    yield* orgQuery((db, organizationId) =>
      db
        .insert(organizationSettings)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: organizationSettings.organizationId, set: values }),
    )
    return yield* loadCompanyDetails
  })

/** Sets the company type on its own, as onboarding does right after creating the company. */
export const setCompanyKind = (kind: CompanyKind) =>
  Effect.gen(function* () {
    yield* requirePermission({ settings: ['manage'] })
    yield* orgQuery((db, organizationId) =>
      db
        .insert(organizationSettings)
        .values({ organizationId, kind })
        .onConflictDoUpdate({ target: organizationSettings.organizationId, set: { kind } }),
    )
    return yield* loadCompanyDetails
  })
