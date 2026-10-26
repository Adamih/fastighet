import { createMiddleware, createStart } from '@tanstack/react-start'
import { COMPANY_HEADER, companyFromSearch } from '#/lib/focus'

/**
 * Sends the company in focus with every server function call from the browser. The router
 * commits the URL before it loads a route, so loaders see the company they navigate to.
 */
const companyHeader = createMiddleware({ type: 'function' }).client(({ next }) => {
  const company = typeof window === 'undefined' ? null : companyFromSearch(window.location.search)
  return next(company ? { headers: { [COMPANY_HEADER]: company } } : {})
})

export const startInstance = createStart(() => ({ functionMiddleware: [companyHeader] }))
