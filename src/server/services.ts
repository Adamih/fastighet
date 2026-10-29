import { Context, Data, type Effect } from 'effect'
import type { Db } from '#/db'
import type { TierId } from '#/features/billing/tiers'
import type { Grant } from '#/lib/managed-access'
import type { CustomRoles, Permissions } from '#/lib/permissions'
import type { Mailer } from './mail/mailer'

export class Database extends Context.Service<Database, Db>()('app/Database') {}

export class CurrentUser extends Context.Service<
  CurrentUser,
  {
    readonly id: string
    readonly email: string
    readonly name: string
    /** The admin acting as this user (Better Auth's impersonation), if one is. */
    readonly impersonatedBy?: { readonly id: string; readonly name: string } | null
  }
>()('app/CurrentUser') {}

/**
 * The company the request acts on (the one in focus). Only `runApp` provides it, after checking
 * membership or a management grant. `grant` is null in the user's own company; in a company their
 * company manages, it is that company's grant and `role` is the one that applies there.
 */
export class CurrentOrganization extends Context.Service<
  CurrentOrganization,
  {
    readonly id: string
    readonly name: string
    readonly role: string
    readonly grant: Grant | null
    /** The home company's custom roles, which `role` may name (at home and on assignments). */
    readonly customRoles: CustomRoles
  }
>()('app/CurrentOrganization') {}

/** The user's own company (Better Auth membership), whichever company is in focus. */
export class HomeOrganization extends Context.Service<
  HomeOrganization,
  {
    readonly id: string
    readonly name: string
    readonly role: string
    /** Its custom roles, which the user's role there or on an assignment may name. */
    readonly customRoles: CustomRoles
  }
>()('app/HomeOrganization') {}

/** Better Auth could not answer a permission check. */
export class PermissionCheckError extends Data.TaggedError('PermissionCheckError')<{
  readonly cause: unknown
}> {}

/** Better Auth's server permission API, bound to the authenticated request by runApp. */
export class PermissionChecker extends Context.Service<
  PermissionChecker,
  {
    readonly check: (
      organizationId: string,
      permissions: Permissions,
    ) => Effect.Effect<boolean, PermissionCheckError>
  }
>()('app/PermissionChecker') {}

/** SCB could not be reached, or answered with something unexpected. */
export class KpiFetchError extends Data.TaggedError('KpiFetchError')<{ readonly cause: unknown }> {}

/** Where new KPI months come from: SCB in production (`features/indexation/scb.ts`), a stub in tests. */
export class KpiSource extends Context.Service<
  KpiSource,
  {
    readonly fetch: Effect.Effect<
      readonly { month: string; valueHundredths: number }[],
      KpiFetchError
    >
  }
>()('app/KpiSource') {}

/**
 * The signed-in admin in the admin dashboard (`runAdmin`). Only there: admin programs never run in
 * a company, and an admin acting as someone else (impersonating) is not one.
 */
export class AdminUser extends Context.Service<
  AdminUser,
  { readonly id: string; readonly name: string; readonly email: string }
>()('app/AdminUser') {}

/** A Better Auth admin endpoint refused or failed; `reason` is its own message, when it gave one. */
export class AdminAuthError extends Data.TaggedError('AdminAuthError')<{
  readonly reason: string | null
  readonly cause: unknown
}> {}

/**
 * Better Auth's admin endpoints, bound to the admin's request by `runAdmin` (they check the admin
 * role themselves too). A stub in tests.
 */
export class AdminAuth extends Context.Service<
  AdminAuth,
  {
    readonly ban: (
      userId: string,
      reason: string,
      expiresInSeconds: number | null,
    ) => Effect.Effect<void, AdminAuthError>
    readonly unban: (userId: string) => Effect.Effect<void, AdminAuthError>
    readonly setAdmin: (userId: string, admin: boolean) => Effect.Effect<void, AdminAuthError>
    readonly revokeSessions: (userId: string) => Effect.Effect<void, AdminAuthError>
  }
>()('app/AdminAuth') {}

/** Stripe (or the database next to it) failed while syncing a subscription. */
export class BillingError extends Data.TaggedError('BillingError')<{ readonly cause: unknown }> {}

/**
 * Stripe for subscriptions, as far as programs need it: whether payment is set up, and keeping a
 * subscription's quantity in step with the company (`features/billing/store.ts`). A stub in tests.
 */
export class Billing extends Context.Service<
  Billing,
  {
    readonly configured: boolean
    readonly syncQuantity: (organizationId: string) => Effect.Effect<void, BillingError>
  }
>()('app/Billing') {}

/**
 * Told by `once()` when a request only replays the stored result of an earlier one, so `runApp`
 * doesn't record the write in the audit log again. Outside `runApp` it does nothing.
 */
export const SubmissionReplay = Context.Reference<{ readonly mark: () => void }>(
  'app/SubmissionReplay',
  { defaultValue: () => ({ mark: () => {} }) },
)

/**
 * The signed-in person in Mina sidor (`runPortal`). Never a company member there: what they see
 * comes from their `party_access` links.
 */
export class PortalUser extends Context.Service<
  PortalUser,
  {
    readonly id: string
    readonly email: string
    readonly name: string
    /** The admin acting as this user (Better Auth's impersonation), if one is. */
    readonly impersonatedBy?: { readonly id: string; readonly name: string } | null
  }
>()('app/PortalUser') {}

/**
 * The company in focus in Mina sidor, and the user's parties there. Portal programs read only
 * what these parties are on (`portalQuery`, `inParties`).
 */
export class PortalCompany extends Context.Service<
  PortalCompany,
  {
    readonly id: string
    readonly name: string
    readonly kind: 'landlord' | 'brf' | 'manager'
    /** Its tier: portal views tied to features the app gates follow it. */
    readonly tier: TierId
    /** The person's parties in the company, by name. */
    readonly parties: readonly { readonly id: string; readonly name: string }[]
    readonly partyIds: readonly string[]
  }
>()('app/PortalCompany') {}

/**
 * The app's public address, for links in emails (e.g. to an avi in Mina sidor). Null when it
 * isn't configured; emails then leave such links out.
 */
export class AppUrl extends Context.Service<AppUrl, { readonly origin: string | null }>()(
  'app/AppUrl',
) {}

/** Built once per Worker isolate from `AppLive` (`live.ts`); the same for every request. */
export type ProcessServices = Database | Mailer | KpiSource | Billing | AppUrl

/** Who is asking and about which company: `runApp` provides them per request. */
export type RequestServices =
  | CurrentUser
  | CurrentOrganization
  | HomeOrganization
  | PermissionChecker

export type AppServices = ProcessServices | RequestServices

/** What portal programs get from `runPortal` (`src/server/portal.ts`). */
export type PortalServices = ProcessServices | PortalUser | PortalCompany
