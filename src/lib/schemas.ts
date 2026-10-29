import { Option, Schema } from 'effect'
import { isIsoDate } from './dates'

// Field schemas shared by feature input schemas. Optional text fields arrive as strings from
// forms; programs turn blanks into null with `blankToNull`.

export const OptionalText = Schema.String.check(Schema.isMaxLength(200))

export const RequiredText = (message: string) =>
  Schema.String.check(
    Schema.isMaxLength(200),
    Schema.makeFilter((s: string) => s.trim().length > 0, { message }),
  )

export const PostalCode = Schema.String.check(
  Schema.isPattern(/^(\d{3} ?\d{2})?$/, { message: 'Postnummer har fem siffror' }),
)

export const Email = Schema.String.check(
  Schema.isPattern(/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Ogiltig e-postadress' }),
)

export const IsoDate = Schema.String.check(
  Schema.makeFilter(isIsoDate, { message: 'Ange ett datum (ÅÅÅÅ-MM-DD)' }),
)

export const blankToNull = (value: string) => value.trim() || null

/**
 * Reads JSON the app stored in a text column, checked against `schema`. Null when the column is
 * empty, the text isn't JSON or the value has another shape, so callers choose the fallback.
 */
export const storedJson = <S extends Schema.Decoder<unknown>>(schema: S) => {
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(schema))
  return (text: string | null | undefined): S['Type'] | null =>
    text ? Option.getOrNull(decode(text)) : null
}

/** Any JSON value, for stored JSON that a cleaning function checks itself (`cleanGrant`, …). */
export const anyStoredJson = storedJson(Schema.Unknown)
