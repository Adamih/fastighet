import { Schema } from 'effect'
import { accessLevels } from '#/lib/managed-access'
import { Email, RequiredText } from '#/lib/schemas'

const Level = Schema.Literals(accessLevels)

/** What a company may do in another, per resource (`GrantLevels`). */
export const GrantLevelsInput = Schema.Struct({
  property: Level,
  tenant: Level,
  lease: Level,
  invoice: Level,
  payment: Level,
  settings: Level,
  bookkeeping: Level,
})

/** The managing company asks for access: its name for the client and who to email the code to. */
export const RequestAccessInput = Schema.Struct({
  label: RequiredText('Ange ett namn för kundbolaget'),
  email: Email,
  levels: GrantLevelsInput,
})
export type RequestAccessInput = typeof RequestAccessInput.Type

export const RequestIdInput = Schema.Struct({ requestId: Schema.String })

export const AssignStaffInput = Schema.Struct({
  managedOrganizationId: Schema.String,
  staff: Schema.Array(
    Schema.Struct({
      userId: Schema.String,
      /** Null: the person's role in their own company. */
      role: Schema.NullOr(Schema.Literals(['admin', 'member', 'viewer'])),
    }),
  ),
})
export type AssignStaffInput = typeof AssignStaffInput.Type

export const CodeInput = Schema.Struct({ code: Schema.String.check(Schema.isMaxLength(40)) })

/** The managed company's owner approves a request and decides the permissions. */
export const AcceptRequestInput = Schema.Struct({
  code: Schema.String.check(Schema.isMaxLength(40)),
  levels: GrantLevelsInput,
  /** The owner confirms a processor agreement (PUB-avtal) with the managing company exists. */
  processorAgreement: Schema.Boolean,
})
export type AcceptRequestInput = typeof AcceptRequestInput.Type

export const GrantIdInput = Schema.Struct({ grantId: Schema.String })

export const UpdateGrantInput = Schema.Struct({ grantId: Schema.String, levels: GrantLevelsInput })
export type UpdateGrantInput = typeof UpdateGrantInput.Type
