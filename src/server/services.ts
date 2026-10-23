import { Context } from 'effect'
import type { Db } from '#/db'
import type { Permissions } from '#/lib/permissions'
import type { Mailer } from './mail/mailer'

export class Database extends Context.Service<Database, Db>()('app/Database') {}

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly id: string; readonly email: string; readonly name: string }
>()('app/CurrentUser') {}

/** The customer company the request acts on. Only `runApp` provides it, after checking membership. */
export class CurrentOrganization extends Context.Service<
  CurrentOrganization,
  { readonly id: string; readonly name: string; readonly role: string }
>()('app/CurrentOrganization') {}

/** Better Auth's server permission API, bound to the authenticated request by runApp. */
export class PermissionChecker extends Context.Service<
  PermissionChecker,
  { readonly check: (organizationId: string, permissions: Permissions) => Promise<boolean> }
>()('app/PermissionChecker') {}

export type AppServices = Database | CurrentUser | CurrentOrganization | Mailer | PermissionChecker
