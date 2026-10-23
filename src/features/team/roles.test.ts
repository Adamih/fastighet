/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { isOwner, memberActions, roles } from './roles'

const actions = (actorRole: string, targetRole = 'member', ownerCount = 1, isSelf = false) =>
  memberActions({ actorRole, targetRole, ownerCount, isSelf })
const none = { roleOptions: [], canRemove: false }

describe('Better Auth member controls', () => {
  test.each([
    'owner',
    'owner,admin',
    'member,owner',
  ])('%p may assign any role and manage another owner', (actorRole) => {
    expect(actions(actorRole)).toEqual({ roleOptions: roles, canRemove: true })
    expect(actions(actorRole, 'owner,admin', 2)).toEqual({ roleOptions: roles, canRemove: true })
  })

  test.each([
    'admin',
    'member,admin',
  ])('%p manages non-owners without granting ownership', (actorRole) => {
    expect(actions(actorRole)).toEqual({ roleOptions: ['member', 'admin'], canRemove: true })
    expect(actions(actorRole, 'admin')).toEqual({
      roleOptions: ['member', 'admin'],
      canRemove: true,
    })
    for (const targetRole of ['owner', 'owner,admin', 'member,owner']) {
      expect(actions(actorRole, targetRole, 2)).toEqual(none)
    }
  })

  test.each(['member', 'guest', ''])('%p cannot manage members', (actorRole) => {
    expect(actions(actorRole)).toEqual(none)
  })

  test.each(['owner', 'admin', 'member'])('%p has no self-actions', (actorRole) => {
    expect(actions(actorRole, actorRole, 2, true)).toEqual(none)
  })

  test('owner count restricts removal, not changing another member’s role', () => {
    expect(actions('owner', 'owner', 1)).toEqual({ roleOptions: roles, canRemove: false })
  })

  test('owner detection uses exact role names, including comma-separated memberships', () => {
    expect(isOwner('member,owner')).toBe(true)
    expect(isOwner('homeowner')).toBe(false)
    expect(isOwner('owner-assistant')).toBe(false)
  })
})
