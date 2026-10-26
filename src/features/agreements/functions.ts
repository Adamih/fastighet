import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import { changeBaseCharge } from './program'
import { ChangeBaseChargeInput } from './schemas'

// Creates new charges, so a retried request must not repeat it.
export const changeBaseChargeFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...ChangeBaseChargeInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(once('changeBaseCharge', data, { lease: ['manage'] }, changeBaseCharge(data))),
  )
