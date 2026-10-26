import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { validate } from '#/server/validate'
import {
  exportSie,
  getBookkeepingSettings,
  listExports,
  previewExport,
  updateBookkeepingSettings,
} from './program'
import { ExportPeriodInput, UpdateBookkeepingSettingsInput } from './schemas'

const requestId = Schema.optional(Schema.String.check(Schema.isMaxLength(100)))

export const bookkeepingSettingsFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(getBookkeepingSettings),
)

export const updateBookkeepingSettingsFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ ...UpdateBookkeepingSettingsInput.fields, requestId })))
  .handler(({ data }) => runApp(updateBookkeepingSettings(data)))

export const previewExportFn = createServerFn({ method: 'GET' })
  .validator(validate(ExportPeriodInput))
  .handler(({ data }) => runApp(previewExport(data)))

// Exporting only records that it happened, so a retry just records it again.
export const exportSieFn = createServerFn({ method: 'POST' })
  .validator(validate(ExportPeriodInput))
  .handler(({ data }) => runApp(exportSie(data)))

export const bookkeepingExportsFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(listExports),
)

export const bookkeepingSettingsQuery = () =>
  queryOptions({ queryKey: ['bookkeeping', 'settings'], queryFn: () => bookkeepingSettingsFn() })

export const previewExportQuery = (period: ExportPeriodInput) =>
  queryOptions({
    queryKey: ['bookkeeping', 'preview', period.fromDate, period.toDate],
    queryFn: () => previewExportFn({ data: period }),
  })

export const bookkeepingExportsQuery = () =>
  queryOptions({ queryKey: ['bookkeeping', 'exports'], queryFn: () => bookkeepingExportsFn() })
