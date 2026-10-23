import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { getSettings, updateSettings } from './program'
import { UpdateSettingsInput } from './schemas'

export const getSettingsFn = createServerFn({ method: 'GET' }).handler(() => runApp(getSettings))

export const updateSettingsFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(UpdateSettingsInput))
  .handler(({ data }) => runApp(updateSettings(data)))

export const settingsQuery = () =>
  queryOptions({ queryKey: ['settings'], queryFn: () => getSettingsFn() })
