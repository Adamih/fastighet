import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { organizationSettings } from '#/db/schema'
import { formatBankgiro } from '#/features/invoicing/rules'
import { formatOrganizationNumber } from '#/features/tenants/organization-number'
import { blankToNull } from '#/lib/schemas'
import { requireManager } from '#/server/authorize'
import { orgQuery } from '#/server/scoped'
import { CurrentOrganization } from '#/server/services'
import type { UpdateSettingsInput } from './schemas'

export const getSettings = Effect.gen(function* () {
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
  }
})

export type Settings = Effect.Success<typeof getSettings>

export const updateSettings = (input: UpdateSettingsInput) =>
  Effect.gen(function* () {
    yield* requireManager
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
    }
    yield* orgQuery((db, organizationId) =>
      db
        .insert(organizationSettings)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: organizationSettings.organizationId, set: values }),
    )
    return yield* getSettings
  })
