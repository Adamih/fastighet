import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import { validate } from '#/server/validate'
import { getCompanyDetails, setCompanyKind, updateCompanyDetails } from './program'
import { SetCompanyKindInput, UpdateCompanyDetailsInput } from './schemas'

export const getCompanyDetailsFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(getCompanyDetails),
)

export const updateCompanyDetailsFn = createServerFn({ method: 'POST' })
  .validator(validate(UpdateCompanyDetailsInput))
  .handler(({ data }) => runApp(updateCompanyDetails(data), audit('settings.update', null)))

export const setCompanyKindFn = createServerFn({ method: 'POST' })
  .validator(validate(SetCompanyKindInput))
  .handler(({ data }) => runApp(setCompanyKind(data.kind), audit('settings.kind', null)))

export const companyDetailsQuery = () =>
  queryOptions({ queryKey: ['company-details'], queryFn: () => getCompanyDetailsFn() })
