import { Schema } from 'effect'

/** Bank files are small; this only stops accidental uploads of something huge. */
const MAX_FILE_CHARS = 5_000_000

export const ImportPaymentsInput = Schema.Struct({
  fileName: Schema.String.check(Schema.isMaxLength(255)),
  content: Schema.String.check(
    Schema.isMinLength(1, { message: 'Filen är tom' }),
    Schema.isMaxLength(MAX_FILE_CHARS, { message: 'Filen är för stor' }),
  ),
})
export type ImportPaymentsInput = typeof ImportPaymentsInput.Type

export const paymentFilters = ['attention', 'matched', 'ignored', 'all'] as const
export type PaymentFilter = (typeof paymentFilters)[number]

export const ListPaymentsInput = Schema.Struct({ filter: Schema.Literals(paymentFilters) })

export const PaymentIdInput = Schema.Struct({ paymentId: Schema.String })

/** Matching a waiting payment by hand: to whom. The split follows from their open avier. */
export const AssignPaymentInput = Schema.Struct({
  paymentId: Schema.String,
  partyId: Schema.String,
})
export type AssignPaymentInput = typeof AssignPaymentInput.Type
