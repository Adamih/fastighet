/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { isOwner, memberActions } from './roles'

const actions = (
  actorRole: string,
  targetRole: string,
  opts: { isSelf?: boolean; owners?: number } = {},
) =>
  memberActions({
    actorRole,
    targetRole,
    isSelf: opts.isSelf ?? false,
    ownerCount: opts.owners ?? 1,
  })

describe('memberActions', () => {
  test.each([
    'owner,admin',
    'member, owner',
    ' owner , admin ',
  ])('protects an owner with multiple roles: %p', (targetRole) => {
    expect(actions('admin', targetRole, { owners: 2 })).toEqual({
      roleOptions: [],
      canRemove: false,
    })
    expect(actions('owner,admin', targetRole, { owners: 1 })).toEqual({
      roleOptions: [],
      canRemove: false,
    })
    expect(actions('member, owner', targetRole, { owners: 2 })).toEqual({
      roleOptions: ['owner', 'admin', 'member'],
      canRemove: true,
    })
  })

  test('members manage nobody', () => {
    expect(actions('member', 'member')).toEqual({ roleOptions: [], canRemove: false })
  })

  test('nobody acts on their own row', () => {
    expect(actions('owner', 'owner', { isSelf: true, owners: 3 })).toEqual({
      roleOptions: [],
      canRemove: false,
    })
  })

  test('admins manage admins and members but never grant owner', () => {
    expect(actions('admin', 'member')).toEqual({
      roleOptions: ['admin', 'member'],
      canRemove: true,
    })
    expect(actions('admin', 'admin')).toEqual({ roleOptions: ['admin', 'member'], canRemove: true })
  })

  test('admins cannot touch owners', () => {
    expect(actions('admin', 'owner', { owners: 2 })).toEqual({ roleOptions: [], canRemove: false })
  })

  test('owners can make anyone an owner', () => {
    expect(actions('owner', 'member').roleOptions).toEqual(['owner', 'admin', 'member'])
  })

  test('the last owner can be neither demoted nor removed', () => {
    expect(actions('owner', 'owner', { owners: 1 })).toEqual({ roleOptions: [], canRemove: false })
  })

  test('another owner can be demoted or removed when one remains', () => {
    expect(actions('owner', 'owner', { owners: 2 })).toEqual({
      roleOptions: ['owner', 'admin', 'member'],
      canRemove: true,
    })
  })
})

describe('isOwner', () => {
  test.each([
    'owner',
    'owner,admin',
    'member, owner',
    ' owner , owner ',
  ])('recognizes owner membership: %p', (role) => expect(isOwner(role)).toBe(true))

  test.each([
    '',
    'admin',
    'member,admin',
    'homeowner',
    'owner-assistant',
  ])('does not treat other roles as owners: %p', (role) => expect(isOwner(role)).toBe(false))
})
