import { describe, expect, test } from 'bun:test'
import { authDestination, canonicalAuthSearch, signedInDestination } from './auth-navigation'

describe('public auth navigation', () => {
  test('invitation destinations survive the legacy-to-library query conversion', () => {
    const search = canonicalAuthSearch('?redirect=%2Finvitations%2Finvite-1')
    expect(new URLSearchParams(search).get('redirectTo')).toBe('/invitations/invite-1')
    expect(new URLSearchParams(search).has('redirect')).toBe(false)
    expect(canonicalAuthSearch(search)).toBe(search)
  })

  test('query and hash in a company destination survive', () => {
    const destination = '/leases?company=client#details'
    expect(authDestination(destination)).toBe(destination)
  })

  test('external and malformed destinations never leave the app', () => {
    for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil.test', 7]) {
      expect(authDestination(value)).toBe('/')
    }
    expect(canonicalAuthSearch('?redirectTo=https%3A%2F%2Fevil.test')).toBe('?redirectTo=%2F')
  })

  test('canonicalization preserves tokens, callback results and reauthentication flags', () => {
    const search = canonicalAuthSearch(
      '?token=secret&error=expired&result=email_verified&reauthenticate=true&redirect=%2Fteam',
    )
    const params = new URLSearchParams(search)
    expect(params.get('token')).toBe('secret')
    expect(params.get('error')).toBe('expired')
    expect(params.get('result')).toBe('email_verified')
    expect(params.get('reauthenticate')).toBe('true')
    expect(params.get('redirectTo')).toBe('/team')
  })

  test('staff always land in admin; customers keep their requested destination', () => {
    expect(signedInDestination({ isAdmin: true }, '/invitations/invite-1')).toBe('/admin')
    expect(signedInDestination({ isAdmin: false }, '/invitations/invite-1')).toBe(
      '/invitations/invite-1',
    )
    expect(signedInDestination({ isAdmin: false }, undefined)).toBe('/')
    expect(signedInDestination(null, '/team')).toBeNull()
  })
})
