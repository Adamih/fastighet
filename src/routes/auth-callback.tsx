import { createFileRoute } from '@tanstack/react-router'
import { authSearch, beforeAuthPage, PublicAuthPage } from '#/features/auth/public-page'

export const Route = createFileRoute('/auth-callback')({
  validateSearch: authSearch,
  beforeLoad: ({ location }) => beforeAuthPage(location),
  component: () => <PublicAuthPage view="callback" />,
})
