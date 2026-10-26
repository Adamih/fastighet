import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import { registerPledge, releasePledge } from './program'
import { RegisterPledgeInput, ReleasePledgeInput } from './schemas'

// Pledges are read with their bostadsrätt (`getOwnership`); these are the writes.

/** Registering creates a record, so a retried request must not repeat it. */
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
      once('registerPledge', data, { lease: ['manage'] }, registerPledge(data)),
      audit('pledge.register'),
    ),
  )

export const releasePledgeFn = createServerFn({ method: 'POST' })
  .validator(validate(ReleasePledgeInput))
  .handler(({ data }) => runApp(releasePledge(data), audit('pledge.release', data.pledgeId)))
