import { Schema } from 'effect'

const YearMonth = Schema.String.check(
  Schema.makeFilter((v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v), {
    message: 'Ange en månad som ÅÅÅÅ-MM',
  }),
)

export const IndexClauseInput = Schema.Struct({
  leaseId: Schema.String,
  sharePercent: Schema.Int.check(
    Schema.isGreaterThan(0, { message: 'Andelen måste vara större än 0 %' }),
    Schema.isLessThanOrEqualTo(100, { message: 'Andelen kan vara högst 100 %' }),
  ),
  baseMonth: YearMonth,
  adjustmentMonth: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(12),
  ),
  floorAtBase: Schema.Boolean,
})
export type IndexClauseInput = typeof IndexClauseInput.Type

export const IndexationYearInput = Schema.Struct({
  year: Schema.Int.check(Schema.isGreaterThanOrEqualTo(2000), Schema.isLessThanOrEqualTo(2100)),
})
export type IndexationYearInput = typeof IndexationYearInput.Type
