import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { runApp } from '#/server/run'
import { validate } from '#/server/validate'
import { getSettings, setCompanyKind, updateSettings } from './program'
import { SetCompanyKindInput, UpdateSettingsInput } from './schemas'

export const getSettingsFn = createServerFn({ method: 'GET' }).handler(() => runApp(getSettings))

export const updateSettingsFn = createServerFn({ method: 'POST' })
  .validator(validate(UpdateSettingsInput))
  .handler(({ data }) => runApp(updateSettings(data)))

export const setCompanyKindFn = createServerFn({ method: 'POST' })
  .validator(validate(SetCompanyKindInput))
  .handler(({ data }) => runApp(setCompanyKind(data.kind)))

export const settingsQuery = () =>
  queryOptions({ queryKey: ['settings'], queryFn: () => getSettingsFn() })
