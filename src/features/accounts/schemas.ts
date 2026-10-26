import { Schema } from 'effect'
import { IsoDate } from '#/lib/schemas'

export const PartyIdInput = Schema.Struct({ partyId: Schema.String })

/** Paying back a party's whole credit balance (tillgodo), on `refundedOn`. */
export const RefundCreditInput = Schema.Struct({ partyId: Schema.String, refundedOn: IsoDate })
export type RefundCreditInput = typeof RefundCreditInput.Type
