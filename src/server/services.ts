import { Context } from 'effect'
import type { Db } from '#/db'
import type { Grant } from '#/lib/managed-access'
import type { Permissions } from '#/lib/permissions'
import type { Mailer } from './mail/mailer'

export class Database extends Context.Service<Database, Db>()('app/Database') {}

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly id: string; readonly email: string; readonly name: string }
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
  }
>()('app/CurrentOrganization') {}

/** The user's own company (Better Auth membership), whichever company is in focus. */
export class HomeOrganization extends Context.Service<
  HomeOrganization,
  { readonly id: string; readonly name: string; readonly role: string }
>()('app/HomeOrganization') {}

/** Better Auth's server permission API, bound to the authenticated request by runApp. */
export class PermissionChecker extends Context.Service<
  PermissionChecker,
  { readonly check: (organizationId: string, permissions: Permissions) => Promise<boolean> }
>()('app/PermissionChecker') {}

/** Where new KPI months come from: SCB in production (`features/indexation/scb.ts`), a stub in tests. */
export class KpiSource extends Context.Service<
  KpiSource,
  { readonly fetch: () => Promise<readonly { month: string; valueHundredths: number }[]> }
>()('app/KpiSource') {}

/**
 * Stripe for subscriptions, as far as programs need it: whether payment is set up, and keeping a
 * subscription's quantity in step with the company (`features/billing/store.ts`). A stub in tests.
 */
export class Billing extends Context.Service<
  Billing,
  {
    readonly configured: boolean
    readonly syncQuantity: (organizationId: string) => Promise<void>
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

export type AppServices =
  | Database
  | CurrentUser
  | CurrentOrganization
  | HomeOrganization
  | Mailer
  | PermissionChecker
  | KpiSource
  | Billing
