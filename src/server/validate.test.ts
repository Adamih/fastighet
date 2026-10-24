import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { validate } from './validate'

test('server validation preserves typed values', async () => {
  expect(await validate(Schema.Struct({ name: Schema.String }))({ name: 'Test' })).toEqual({
    name: 'Test',
  })
})

test('server validation sends a structured validation failure', async () => {
  const input = Schema.Struct({
    name: Schema.String.check(Schema.isMinLength(1, { message: 'Ange ett namn' })),
  })
  await expect(validate(input)({ name: '' })).rejects.toMatchObject({
    kind: 'app-error',
    code: 'validation',
    message: 'Ange ett namn',
  })
})
