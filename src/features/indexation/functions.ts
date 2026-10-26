import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { LeaseIdInput } from '#/features/leases/schemas'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import { indexationPreview, removeIndexClause, runIndexation, setIndexClause } from './program'
import { IndexationYearInput, IndexClauseInput, RunIndexationInput } from './schemas'

const requestId = Schema.optional(Schema.String.check(Schema.isMaxLength(100)))

export const setIndexClauseFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ ...IndexClauseInput.fields, requestId })))
  .handler(({ data }) => runApp(setIndexClause(data)))

export const removeIndexClauseFn = createServerFn({ method: 'POST' })
  .validator(validate(LeaseIdInput))
  .handler(({ data }) => runApp(removeIndexClause(data.leaseId)))

export const indexationPreviewFn = createServerFn({ method: 'GET' })
  .validator(validate(IndexationYearInput))
  .handler(({ data }) => runApp(indexationPreview(data.year)))

// Changes charges on many leases, so a retried request must not repeat it (a repeat for the same
// year changes nothing anyway).
export const runIndexationFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ ...RunIndexationInput.fields, requestId })))
  .handler(({ data }) =>
    runApp(
      once(
        'runIndexation',
        data,
        { lease: ['manage'] },
        runIndexation(data.year, { notify: data.notify }),
      ),
    ),
  )

export const indexationPreviewQuery = (year: number) =>
  queryOptions({
    queryKey: ['leases', 'indexation', year],
    queryFn: () => indexationPreviewFn({ data: { year } }),
  })
