import { QueryClient } from '@tanstack/react-query'
import { retryRead } from '#/lib/app-errors'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: retryRead }, mutations: { retry: false } },
  })

  return {
    queryClient,
  }
}
export default function TanstackQueryProvider() {}
