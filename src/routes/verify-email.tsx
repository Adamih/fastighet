import { createFileRoute } from '@tanstack/react-router'
import { authSearch, beforeAuthPage, PublicAuthPage } from '#/features/auth/public-page'

export const Route = createFileRoute('/verify-email')({
  validateSearch: authSearch,
  beforeLoad: ({ location }) => beforeAuthPage(location),
  component: () => <PublicAuthPage view="verifyEmail" />,
})
