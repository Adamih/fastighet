import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { getTeam, removeMember, updateMemberRole } from './program'
import { MemberIdInput, UpdateMemberRoleInput } from './schemas'

export const getTeamFn = createServerFn({ method: 'GET' }).handler(() => runApp(getTeam))

export const teamQuery = () => queryOptions({ queryKey: ['team'], queryFn: () => getTeamFn() })

export const updateMemberRoleFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(UpdateMemberRoleInput))
  .handler(({ data }) => runApp(updateMemberRole(data)))

export const removeMemberFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(MemberIdInput))
  .handler(({ data }) => runApp(removeMember(data.memberId)))
