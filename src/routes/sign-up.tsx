import { createFileRoute } from '@tanstack/react-router'
import { authSearch, beforeAuthPage, PublicAuthPage } from '#/features/auth/public-page'

export const Route = createFileRoute('/sign-up')({
  validateSearch: authSearch,
  beforeLoad: ({ location }) => beforeAuthPage(location, true),
  component: () => <PublicAuthPage view="signUp" />,
})
