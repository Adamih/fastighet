import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { runApp } from '#/server/run'
import { validate } from '#/server/validate'
import { partyAccount, refundCredit, undoCreditRefund } from './program'
import { PartyIdInput, RefundCreditInput } from './schemas'

export const partyAccountFn = createServerFn({ method: 'GET' })
  .validator(validate(PartyIdInput))
  .handler(({ data }) => runApp(partyAccount(data.partyId)))

export const refundCreditFn = createServerFn({ method: 'POST' })
  .validator(validate(RefundCreditInput))
  .handler(({ data }) => runApp(refundCredit(data)))

export const undoCreditRefundFn = createServerFn({ method: 'POST' })
  .validator(validate(PartyIdInput))
  .handler(({ data }) => runApp(undoCreditRefund(data.partyId)))

export const partyAccountQuery = (partyId: string) =>
  queryOptions({
    queryKey: ['invoices', 'account', partyId],
    queryFn: () => partyAccountFn({ data: { partyId } }),
  })
