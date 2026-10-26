import { describe, expect, test } from 'bun:test'
import {
  cleanGrant,
  grantFromLevels,
  grantPresets,
  isEmptyGrant,
  levelsFromGrant,
  managedAllows,
  presetOf,
} from './managed-access'

describe('grants', () => {
  test('manage always brings read', () => {
    expect(grantFromLevels({ lease: 'manage', invoice: 'read' })).toEqual({
      lease: ['read', 'manage'],
      invoice: ['read'],
    })
  })

  test('cleaning drops what can never be granted', () => {
    expect(
      cleanGrant({
        member: ['delete'],
        organization: ['delete'],
        invitation: ['create'],
        grant: ['manage'],
        client: ['manage'],
        lease: ['manage'],
        invoice: ['delete', 'read'],
        payment: 'manage',
      }),
    ).toEqual({ lease: ['read', 'manage'], invoice: ['read'] })
    expect(cleanGrant(null)).toEqual({})
    expect(cleanGrant('{"lease":["read"]}')).toEqual({})
  })

  test('levels round-trip and presets are recognised', () => {
    expect(levelsFromGrant(grantPresets.finance).invoice).toBe('manage')
    expect(levelsFromGrant(grantPresets.finance).lease).toBe('read')
    expect(presetOf(grantFromLevels(levelsFromGrant(grantPresets.readOnly)))).toBe('readOnly')
    expect(presetOf(grantFromLevels({ lease: 'read' }))).toBeNull()
    expect(isEmptyGrant(grantFromLevels({}))).toBe(true)
  })
})

describe('managedAllows: the role AND the grant', () => {
  test('the grant caps an owner', () => {
    expect(managedAllows('owner', grantPresets.finance, { invoice: ['manage'] })).toBe(true)
    expect(managedAllows('owner', grantPresets.finance, { lease: ['manage'] })).toBe(false)
    expect(managedAllows('owner', grantPresets.finance, { lease: ['read'] })).toBe(true)
  })

  test('the role caps a full grant', () => {
    expect(managedAllows('member', grantPresets.full, { bookkeeping: ['read'] })).toBe(false)
    expect(managedAllows('member', grantPresets.full, { settings: ['manage'] })).toBe(false)
    expect(managedAllows('member', grantPresets.full, { lease: ['manage'] })).toBe(true)
    expect(managedAllows('viewer', grantPresets.full, { lease: ['read'] })).toBe(true)
    expect(managedAllows('viewer', grantPresets.full, { lease: ['manage'] })).toBe(false)
  })

  test("never the managed company's team, invitations or grants, even for an owner", () => {
    const everything = { ...grantPresets.full, member: ['delete'], grant: ['manage'] } as never
    expect(managedAllows('owner', everything, { member: ['delete'] })).toBe(false)
    expect(managedAllows('owner', everything, { invitation: ['create'] })).toBe(false)
    expect(managedAllows('owner', everything, { grant: ['manage'] })).toBe(false)
    expect(managedAllows('owner', everything, { client: ['read'] })).toBe(false)
  })

  test('every permission asked for must be allowed', () => {
    const mixed = { invoice: ['manage'], lease: ['manage'] } as const
    expect(managedAllows('admin', grantPresets.finance, { ...mixed } as never)).toBe(false)
    expect(managedAllows('admin', grantPresets.full, { ...mixed } as never)).toBe(true)
    expect(managedAllows('admin', grantPresets.full, { lease: [] })).toBe(false)
  })

  test('several roles: any one is enough; unknown roles get nothing', () => {
    expect(managedAllows('viewer,admin', grantPresets.full, { settings: ['manage'] })).toBe(true)
    expect(managedAllows('guest', grantPresets.full, { lease: ['read'] })).toBe(false)
    expect(managedAllows('toString', grantPresets.full, { lease: ['read'] })).toBe(false)
    expect(managedAllows('', grantPresets.full, { lease: ['read'] })).toBe(false)
  })
})
