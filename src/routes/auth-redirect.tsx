import { createFileRoute } from '@tanstack/react-router'
import { authSearch, beforeAuthPage, PublicAuthPage } from '#/features/auth/public-page'

export const Route = createFileRoute('/auth-redirect')({
  validateSearch: authSearch,
  beforeLoad: ({ location }) => beforeAuthPage(location),
  component: () => <PublicAuthPage view="redirect" />,
})
