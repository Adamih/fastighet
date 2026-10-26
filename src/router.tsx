import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { getContext } from './integrations/tanstack-query/root-provider'
import { routeTree } from './routeTree.gen'

const companyOf = (search: object) =>
  'company' in search && typeof search.company === 'string' ? search.company : null

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  // Query keys don't name the company, so cached data belongs to the company in focus. Switching
  // company (including with the back button) drops it before the new company's loaders run.
  router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
    if (fromLocation && companyOf(fromLocation.search) !== companyOf(toLocation.search)) {
      context.queryClient.clear()
    }
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
