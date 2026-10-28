import { createFileRoute, notFound } from '@tanstack/react-router'
import { Settings } from '#/components/auth/settings/settings'
import { PageHeader } from '#/components/responsive'
import { settingsPaths } from '#/lib/auth/paths'
import { m } from '#/paraglide/messages'

// The signed-in user's own account (Better Auth UI's settings): profile and email, password and
// the devices they're signed in on. Personal, so it's the same whichever company is in focus.
export const Route = createFileRoute('/_app/account/$path')({
  beforeLoad: ({ params }) => {
    if (!settingsPaths.includes(params.path)) throw notFound()
  },
  component: AccountPage,
})

function AccountPage() {
  const { path } = Route.useParams()
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title={m.my_account_title()} subtitle={m.my_account_subtitle()} />
      <Settings path={path} />
    </div>
  )
}
