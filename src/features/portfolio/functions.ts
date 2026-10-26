import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { runApp } from '#/server/run'
import { portfolio } from './program'

export const portfolioFn = createServerFn({ method: 'GET' }).handler(() => runApp(portfolio))

export const portfolioQuery = () =>
  queryOptions({ queryKey: ['portfolio'], queryFn: () => portfolioFn() })
