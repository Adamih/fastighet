/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { memberActions, roles } from './roles'

describe('memberActions', () => {
  test.each([
    'owner',
    'admin',
    'member, admin',
    ' owner , admin ',
  ])('%p can assign every role and remove other members', (actorRole) => {
    expect(memberActions({ actorRole, isSelf: false })).toEqual({
      roleOptions: roles,
      canRemove: true,
    })
  })

  test.each(['member', 'guest', ''])('%p cannot manage members', (actorRole) => {
    expect(memberActions({ actorRole, isSelf: false })).toEqual({
      roleOptions: [],
      canRemove: false,
    })
  })

  test.each(['owner', 'admin', 'member'])('%p cannot act on their own row', (actorRole) => {
    expect(memberActions({ actorRole, isSelf: true })).toEqual({
      roleOptions: [],
      canRemove: false,
    })
  })
})
