// Every session belongs to one workspace: `staff` (the app at /, for company members) or `portal`
// (Mina sidor at /portal, for tenants and members). The login page used decides it, on the
// server, when the session is created; a session never reaches the other workspace, and the
// only way across is signing out. One account may have both (e.g. a board member who owns a
// bostadsrätt). Client-safe.

export const workspaces = ['staff', 'portal'] as const
export type Workspace = (typeof workspaces)[number]

/**
 * The workspace a new session belongs to, by the Better Auth endpoint that creates it. Null for
 * any other path: the session is refused, so a sign-in method added later can't open a
 * workspace by accident.
 */
export function workspaceForSignIn(path: string | null | undefined): Workspace | null {
  switch (path) {
    // Mina sidor: the emailed code, also used when accepting a portal invitation.
    case '/sign-in/email-otp':
      return 'portal'
    // The app: password sign-in, and the sign-in after verifying the email address.
    case '/sign-in/email':
    case '/verify-email':
    // An admin acting as a user, and back.
    case '/admin/impersonate-user':
    case '/admin/stop-impersonating':
      return 'staff'
    default:
      return null
  }
}

/** Where a session's workspace starts. */
export const workspaceHome = (workspace: Workspace) => (workspace === 'portal' ? '/portal' : '/')

/** A session's workspace; sessions from before workspaces existed are the app's. */
export const sessionWorkspace = (session: { workspace?: string | null }): Workspace =>
  session.workspace === 'portal' ? 'portal' : 'staff'

/**
 * Sent with Better Auth's impersonate request when an admin starts acting as the user in Mina
 * sidor. Only admins can impersonate (the admin plugin checks), and a portal session still needs
 * portal access.
 */
export const IMPERSONATE_WORKSPACE_HEADER = 'x-fastighet-workspace'

/**
 * Better Auth endpoints a Mina sidor session may never use: companies, teams, roles, invitations
 * and subscriptions, and the admin dashboard (except ending an admin's impersonation). They don't
 * go through `runApp`, so the workspace is checked in a hook.
 */
export function blockedForPortal(path: string): boolean {
  if (path === '/admin/stop-impersonating') return false
  return ['/organization/', '/admin/', '/subscription/'].some((prefix) => path.startsWith(prefix))
}
