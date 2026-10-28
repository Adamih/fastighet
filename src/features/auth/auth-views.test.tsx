import { expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { renderToString } from 'react-dom/server'
import { Auth } from '#/components/auth/auth'
import { AuthProvider } from '#/components/auth/auth-provider'
import { authBasePaths, authViewPaths } from '#/lib/auth/paths'
import { svSE } from '#/lib/auth/sv-se'
import { authClient } from '#/lib/auth-client'

function render(view: 'signIn' | 'signUp' | 'forgotPassword' | 'resetPassword' | 'verifyEmail') {
  return renderToString(
    <AuthProvider
      authClient={authClient}
      queryClient={new QueryClient()}
      locale={svSE}
      navigate={() => {}}
      Link={({ href, children, ...props }) => (
        <a href={href} {...props}>
          {children}
        </a>
      )}
      basePaths={authBasePaths}
      viewPaths={authViewPaths}
      redirectTo="/invitations/invite-1"
      emailAndPassword={{ enabled: true, requireEmailVerification: true, confirmPassword: true }}
    >
      <Auth view={view} />
    </AuthProvider>,
  )
}

test('login renders Swedish email/password fields and keeps the invitation in its links', () => {
  const html = render('signIn')
  expect(html).toContain('Logga in')
  expect(html).toContain('type="email"')
  expect(html).toMatch(/autocomplete="current-password"/i)
  expect(html).toContain('/sign-up?redirectTo=%2Finvitations%2Finvite-1')
  expect(html).toContain('/forgot-password?redirectTo=%2Finvitations%2Finvite-1')
})

test('signup renders name, password confirmation and a return link', () => {
  const html = render('signUp')
  expect(html).toContain('Skapa konto')
  expect(html).toMatch(/autocomplete="name"/i)
  expect(html).toContain('Bekräfta lösenord')
  expect(html).toContain('/login?redirectTo=%2Finvitations%2Finvite-1')
})

test('password recovery and verification retain their login return paths', () => {
  for (const view of ['forgotPassword', 'resetPassword', 'verifyEmail'] as const) {
    const html = render(view)
    expect(html).toContain('/login?redirectTo=%2Finvitations%2Finvite-1')
  }
  expect(render('resetPassword')).toContain('Bekräfta lösenord')
})
