import { Schema } from 'effect'
import { roles } from './roles'

export const MemberIdInput = Schema.Struct({ memberId: Schema.String })
export const UpdateMemberRoleInput = Schema.Struct({
  ...MemberIdInput.fields,
  role: Schema.Literals(roles),
})
export type UpdateMemberRoleInput = typeof UpdateMemberRoleInput.Type
