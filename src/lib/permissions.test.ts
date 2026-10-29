/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { authClient } from './auth-client'
import {
  appPermissions,
  type Permissions,
  reservedRoleNames,
  roleAllows,
  type roles,
} from './permissions'

const can = (role: string, permissions: Permissions) =>
  authClient.organization.checkRolePermission({ role: role as keyof typeof roles, permissions })

const appResources = ['property', 'tenant', 'lease', 'invoice', 'payment'] as const

describe('Better Auth role permissions', () => {
  test.each(['owner', 'admin'])('%p has full access to everything', (role) => {
    for (const resource of [...appResources, 'settings', 'bookkeeping'] as const) {
      expect(can(role, { [resource]: ['read', 'manage'] })).toBe(true)
    }
  })

  test('member has full access to daily work', () => {
    for (const resource of appResources) {
      expect(can('member', { [resource]: ['read', 'manage'] })).toBe(true)
    }
  })

  test('member can read but not manage settings', () => {
    expect(can('member', { settings: ['read'] })).toBe(true)
    expect(can('member', { settings: ['manage'] })).toBe(false)
  })

  test('member cannot export the books or change accounts', () => {
    expect(can('member', { bookkeeping: ['read'] })).toBe(false)
    expect(can('member', { bookkeeping: ['manage'] })).toBe(false)
  })

  test('Better Auth team permissions are unchanged, except that nobody deletes the company', () => {
    expect(can('owner', { organization: ['update'] })).toBe(true)
    expect(can('owner', { organization: ['delete'] })).toBe(false)
    expect(can('admin', { organization: ['delete'] })).toBe(false)
    expect(can('admin', { member: ['delete'], invitation: ['create'] })).toBe(true)
    expect(can('member', { invitation: ['create'] })).toBe(false)
    expect(can('member', { member: ['update'] })).toBe(false)
  })

  test('every permission in a request must be granted', () => {
    const mixed: Permissions = { invoice: ['manage'], settings: ['manage'] }
    expect(can('member', mixed)).toBe(false)
    expect(can('admin', mixed)).toBe(true)
  })

  test('multiple roles: any role granting the request is enough', () => {
    expect(can('member,admin', { settings: ['manage'] })).toBe(true)
    expect(can('owner,admin', { member: ['update'] })).toBe(true)
  })

  test('unknown roles get nothing', () => {
    expect(can('guest', { property: ['read'] })).toBe(false)
    expect(can('', { property: ['read'] })).toBe(false)
  })
})

describe('custom roles', () => {
  test('hold app resources only, with manage bringing read', () => {
    expect(appPermissions({ invoice: ['manage'], lease: ['read'], tenant: [] })).toEqual({
      invoice: ['read', 'manage'],
      lease: ['read'],
    })
    expect(appPermissions({ member: ['delete'] })).toBeNull()
    expect(appPermissions({ client: ['read'] })).toBeNull()
    expect(appPermissions({ invoice: ['delete'] })).toBeNull()
    expect(appPermissions([])).toBeNull()
    expect(appPermissions('x')).toBeNull()
  })

  test('the built-in names are taken', () => {
    expect([...reservedRoleNames].sort()).toEqual(['admin', 'member', 'owner', 'viewer'])
  })

  test('a role allows what its own or the built-in statements say, and nothing else', () => {
    const customRoles = { ekonom: { invoice: ['read', 'manage'] as ('read' | 'manage')[] } }
    expect(roleAllows('ekonom', { invoice: ['manage'] }, customRoles)).toBe(true)
    expect(roleAllows('ekonom', { invoice: ['manage'], lease: ['read'] }, customRoles)).toBe(false)
    expect(roleAllows('ekonom,member', { lease: ['manage'] }, customRoles)).toBe(true)
    // Built-in roles answer as Better Auth does.
    expect(roleAllows('member', { settings: ['manage'] }, customRoles)).toBe(false)
    expect(roleAllows('admin', { settings: ['manage'] }, {})).toBe(true)
    expect(roleAllows('gone', { invoice: ['read'] }, customRoles)).toBe(false)
    expect(roleAllows('toString', { invoice: ['read'] }, customRoles)).toBe(false)
    expect(roleAllows('ekonom', { invoice: [] }, customRoles)).toBe(false)
  })
})
