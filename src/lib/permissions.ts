import { createAccessControl } from 'better-auth/plugins/access'
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access'

// Role-based access control, shared by Better Auth (organization plugin), the server
// permission API and client checkRolePermission helper. Client-safe: no server imports.
//
// Every app resource has two permissions: `read` (view it) and `manage` (create, edit and delete
// it). `manage` does not imply `read`; every role that manages something is also given read.
// Better Auth's own statements (organization, member, invitation, team, ac) are kept as they are.

export const statement = {
  ...defaultStatements,
  /** Properties and their units. */
  property: ['read', 'manage'],
  tenant: ['read', 'manage'],
  lease: ['read', 'manage'],
  invoice: ['read', 'manage'],
  payment: ['read', 'manage'],
  /** Company settings printed on invoices (bankgiro, address, …). */
  settings: ['read', 'manage'],
  /** The SIE export (`read`) and the company's account numbers (`manage`). */
  bookkeeping: ['read', 'manage'],
} as const

export const ac = createAccessControl(statement)

const full = ['read', 'manage'] as const
const readOnly = ['read'] as const

const appFull = {
  property: full,
  tenant: full,
  lease: full,
  invoice: full,
  payment: full,
  settings: full,
  bookkeeping: full,
}

export const owner = ac.newRole({ ...ownerAc.statements, ...appFull })
export const admin = ac.newRole({ ...adminAc.statements, ...appFull })
/**
 * Runs the day-to-day work; cannot change company settings, manage the team, or export the books.
 */
const { bookkeeping: _, ...memberApp } = appFull
export const member = ac.newRole({ ...memberAc.statements, ...memberApp, settings: readOnly })

export const roles = { owner, admin, member }

type Statement = typeof statement
export type Permissions = { [K in keyof Statement]?: Statement[K][number][] }
