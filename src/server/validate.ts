import { Schema } from 'effect'
import { appError } from '#/lib/app-errors'

/** Return safe validation text without exposing decoder internals or raw submitted data. */
export function validate<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const standard = Schema.toStandardSchemaV1(schema)
  return async (input: unknown): Promise<S['Type']> => {
    const result = await standard['~standard'].validate(input)
    if (result.issues) {
      throw appError(
        'validation',
        result.issues[0]?.message ?? 'Kontrollera uppgifterna i formuläret.',
      )
    }
    return result.value
  }
}
