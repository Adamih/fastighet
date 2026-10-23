/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { can, type Permissions } from './permissions'

const appResources = ['property', 'tenant', 'lease', 'invoice', 'payment'] as const

describe('can', () => {
  test.each(['owner', 'admin'])('%p has full access to everything', (role) => {
    for (const resource of [...appResources, 'settings'] as const) {
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

  test('Better Auth team permissions are unchanged', () => {
    expect(can('owner', { organization: ['delete'] })).toBe(true)
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
    expect(can('member, admin', { settings: ['manage'] })).toBe(true)
  })

  test('unknown roles get nothing', () => {
    expect(can('guest', { property: ['read'] })).toBe(false)
    expect(can('', { property: ['read'] })).toBe(false)
  })
})
