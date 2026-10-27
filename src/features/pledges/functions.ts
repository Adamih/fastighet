import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import { confirmPledge, pledgeConfirmation, registerAndConfirm } from './confirmation'
import { releasePledge } from './program'
import {
  ConfirmPledgeInput,
  PledgeConfirmationInput,
  RegisterPledgeInput,
  ReleasePledgeInput,
} from './schemas'

// Pledges are read with their bostadsrätt (`getOwnership`); besides the writes, a pledge has the
// förening's confirmations to the lender.

/**
 * Registering creates a record, so a retried request must not repeat it. With the lender's email
 * it also sends the confirmation.
 */
export const registerPledgeFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...RegisterPledgeInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once('registerPledge', data, { lease: ['manage'] }, registerAndConfirm(data)),
      audit('pledge.register'),
    ),
  )

export const releasePledgeFn = createServerFn({ method: 'POST' })
  .validator(validate(ReleasePledgeInput))
  .handler(({ data }) => runApp(releasePledge(data), audit('pledge.release', data.pledgeId)))

export const pledgeConfirmationFn = createServerFn({ method: 'GET' })
  .validator(validate(PledgeConfirmationInput))
  .handler(({ data }) => runApp(pledgeConfirmation(data)))

export const pledgeConfirmationQuery = (input: PledgeConfirmationInput) =>
  queryOptions({
    queryKey: ['ownerships', 'pledges', input.pledgeId, 'confirmation', input.kind],
    queryFn: () => pledgeConfirmationFn({ data: input }),
  })

/** Emails the confirmation to the lender, or records that it went by post. */
export const confirmPledgeFn = createServerFn({ method: 'POST' })
  .validator(validate(ConfirmPledgeInput))
  .handler(({ data }) => runApp(confirmPledge(data), audit('pledge.confirm', data.pledgeId)))
