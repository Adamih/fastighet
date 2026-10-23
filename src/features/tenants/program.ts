import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { tenant } from '#/db/schema'
import { blankToNull } from '#/lib/schemas'
import { Conflict } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { formatOrganizationNumber } from './organization-number'
import type { CreateTenantInput } from './schemas'

export const listTenants = orgQuery((db, organizationId) =>
  db.query.tenant.findMany({
    where: eq(tenant.organizationId, organizationId),
    orderBy: asc(tenant.name),
  }),
)

export const createTenant = (input: CreateTenantInput) =>
  Effect.gen(function* () {
    const organizationNumber =
      input.kind === 'company' && input.organizationNumber.trim()
        ? formatOrganizationNumber(input.organizationNumber)
        : null

    if (organizationNumber) {
      const existing = yield* orgQuery((db, organizationId) =>
        db.query.tenant.findFirst({
          columns: { name: true },
          where: and(
            eq(tenant.organizationId, organizationId),
            eq(tenant.organizationNumber, organizationNumber),
          ),
        }),
      )
      if (existing) {
        return yield* new Conflict({
          message: `${existing.name} har redan organisationsnummer ${organizationNumber}`,
        })
      }
    }

    const [created] = yield* orgQuery((db, organizationId) =>
      db
        .insert(tenant)
        .values({
          organizationId,
          kind: input.kind,
          name: input.name.trim(),
          organizationNumber,
          email: blankToNull(input.email),
          phone: blankToNull(input.phone),
          streetAddress: blankToNull(input.streetAddress),
          postalCode: blankToNull(input.postalCode.replace(/\s/g, '')),
          city: blankToNull(input.city),
        })
        .returning(),
    )
    return created
  })
