import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { runApp } from '#/server/run'
import { validate } from '#/server/validate'
import { getSettings, updateSettings } from './program'
import { UpdateSettingsInput } from './schemas'

export const getSettingsFn = createServerFn({ method: 'GET' }).handler(() => runApp(getSettings))

export const updateSettingsFn = createServerFn({ method: 'POST' })
  .validator(validate(UpdateSettingsInput))
  .handler(({ data }) => runApp(updateSettings(data)))

export const settingsQuery = () =>
  queryOptions({ queryKey: ['settings'], queryFn: () => getSettingsFn() })
