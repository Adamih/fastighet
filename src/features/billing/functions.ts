import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { runApp } from '#/server/run'
import { getPlan } from './program'

// Subscriptions are bought and changed through Better Auth's Stripe plugin (`authClient`), so the
// only server function here reads the plan page.

export const getPlanFn = createServerFn({ method: 'GET' }).handler(() => runApp(getPlan))

export const planQuery = () => queryOptions({ queryKey: ['plan'], queryFn: () => getPlanFn() })
