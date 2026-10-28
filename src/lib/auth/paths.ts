// Where Better Auth UI's views live in this app, shared by the provider (`components/providers`)
// and the routes that render them. Sign-in and password resets are our own pages.

export const authBasePaths = { auth: '', settings: '/account' } as const

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

/** The account settings pages ("/account/profile", "/account/security"). */
export const settingsPaths: readonly string[] = Object.values(authViewPaths.settings)
