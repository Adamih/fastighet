import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { runApp } from '#/server/run'
import { getTeam } from './program'

export const getTeamFn = createServerFn({ method: 'GET' }).handler(() => runApp(getTeam))

export const teamQuery = () => queryOptions({ queryKey: ['team'], queryFn: () => getTeamFn() })
