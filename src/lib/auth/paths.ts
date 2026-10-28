// Where Better Auth UI's views live in this app, shared by the provider (`components/providers`)
// and the routes that render them. Sign-in and password resets are our own pages.

export const authBasePaths = { auth: '', settings: '/account', organization: '' } as const

export const authViewPaths = {
  auth: {
    signIn: 'login',
    signUp: 'login',
    signOut: 'sign-out',
    forgotPassword: 'forgot-password',
    resetPassword: 'reset-password',
  },
  settings: { account: 'profile', security: 'security' },
} as const

/**
 * The organization plugin's paths. We use its people view (users and invitations) on our own
 * Team page, not its organization pages, so every organization view leads to /team.
 */
export const organizationViewPaths = {
  settings: { organizations: 'companies' },
  organization: { settings: 'team', people: 'team', teams: 'team', roles: 'team' },
} as const

/** The account settings pages ("/account/profile", "/account/security", "/account/companies"). */
export const settingsPaths: readonly string[] = [
  ...Object.values(authViewPaths.settings),
  organizationViewPaths.settings.organizations,
]
