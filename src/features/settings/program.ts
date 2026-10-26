import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { organizationSettings } from '#/db/schema'
import { formatBankgiro } from '#/features/invoicing/rules'
import {
  DEFAULT_REMINDER_DUE_DAYS,
  DEFAULT_REMINDER_INTERVAL_DAYS,
} from '#/features/reminders/rules'
import { formatOrganizationNumber } from '#/features/tenants/organization-number'
import { parseSek } from '#/lib/money'
import { blankToNull } from '#/lib/schemas'
import { requirePermission } from '#/server/authorize'
import { orgQuery } from '#/server/scoped'
import { CurrentOrganization } from '#/server/services'
import type { CompanyKind } from './company-kinds'
import type { UpdateSettingsInput } from './schemas'

/**
 * The seller details, without a permission check: invoices print them for anyone who may work
 * with invoices. The settings page itself goes through `getSettings`.
 */
export const loadSettings = Effect.gen(function* () {
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
  }
})

export type Settings = Effect.Success<typeof loadSettings>

export const getSettings = requirePermission({ settings: ['read'] }).pipe(
  Effect.andThen(loadSettings),
)

export const updateSettings = (input: UpdateSettingsInput) =>
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
    }
    yield* orgQuery((db, organizationId) =>
      db
        .insert(organizationSettings)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: organizationSettings.organizationId, set: values }),
    )
    return yield* loadSettings
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
    return yield* loadSettings
  })
