import { expect, test } from 'bun:test'
import { sessionWorkspace, workspaceForSignIn, workspaceHome } from './workspace'

test('the login page decides the workspace: a code for Mina sidor, a password for the app', () => {
  expect(workspaceForSignIn('/sign-in/email-otp')).toBe('portal')
  expect(workspaceForSignIn('/sign-in/email')).toBe('staff')
  expect(workspaceForSignIn('/verify-email')).toBe('staff')
  expect(workspaceForSignIn('/admin/impersonate-user')).toBe('staff')
})

test('any other way of creating a session is refused', () => {
  for (const path of [
    '/sign-in/social',
    '/sign-up/email',
    '/magic-link/verify',
    '',
    null,
    undefined,
  ]) {
    expect(workspaceForSignIn(path)).toBeNull()
  }
})

test('each workspace has its home, and old sessions are the app', () => {
  expect(workspaceHome('portal')).toBe('/portal')
  expect(workspaceHome('staff')).toBe('/')
  expect(sessionWorkspace({})).toBe('staff')
  expect(sessionWorkspace({ workspace: 'portal' })).toBe('portal')
})
