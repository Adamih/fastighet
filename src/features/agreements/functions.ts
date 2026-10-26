import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import { addOneOffCharge, changeBaseCharge, removeOneOffCharge } from './program'
import { AddOneOffChargeInput, ChangeBaseChargeInput, ChargeIdInput } from './schemas'

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
    runApp(
      once('changeBaseCharge', data, { lease: ['manage'] }, changeBaseCharge(data)),
      audit('charge.change_base', data.agreementId),
    ),
  )

export const addOneOffChargeFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...AddOneOffChargeInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once('addOneOffCharge', data, { lease: ['manage'] }, addOneOffCharge(data)),
      audit('charge.add_one_off', data.agreementId),
    ),
  )

export const removeOneOffChargeFn = createServerFn({ method: 'POST' })
  .validator(validate(ChargeIdInput))
  .handler(({ data }) =>
    runApp(removeOneOffCharge(data.chargeId), audit('charge.remove_one_off', null)),
  )
