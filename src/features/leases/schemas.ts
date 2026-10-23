import { Schema } from 'effect'
import { IsoDate } from '#/lib/schemas'
import { invoiceIntervals, rentIntervals } from './options'

export const LeaseIdInput = Schema.Struct({ leaseId: Schema.String })

export const CreateLeaseInput = Schema.Struct({
  tenantId: Schema.String.check(Schema.isMinLength(1, { message: 'Välj en hyresgäst' })),
  unitIds: Schema.Array(Schema.String).check(
    Schema.isMinLength(1, { message: 'Välj minst ett objekt' }),
  ),
  startDate: IsoDate,
  endDate: Schema.NullOr(IsoDate),
  extensionMonths: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  noticePeriodMonths: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rentOre: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rentInterval: Schema.Literals(rentIntervals),
  invoiceInterval: Schema.Literals(invoiceIntervals),
  vat: Schema.Boolean,
})
export type CreateLeaseInput = typeof CreateLeaseInput.Type

export const TerminateLeaseInput = Schema.Struct({
  leaseId: Schema.String,
  noticeDate: IsoDate,
  /** Null means "the earliest date the lease allows". */
  moveOutDate: Schema.NullOr(IsoDate),
})
export type TerminateLeaseInput = typeof TerminateLeaseInput.Type
