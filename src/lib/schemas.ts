import { Schema } from 'effect'
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
