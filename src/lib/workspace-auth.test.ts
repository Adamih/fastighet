/// <reference types="bun" />
import { Database as Sqlite } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import Stripe from 'stripe'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import type { AnyEmail } from '#/server/mail/mailer'
import { createAuth } from './auth-config'

// Sessions and workspaces against the real Better Auth handler: a code signs in to Mina sidor, a
// password to the app, and nothing else creates a session (`src/lib/workspace.ts`).

const connections: Sqlite[] = []
afterEach(() => {
  for (const sqlite of connections.splice(0)) sqlite.close()
})

const PASSWORD = 'correct-horse-battery'

async function fixture() {
  const sqlite = new Sqlite(':memory:')
  connections.push(sqlite)
  sqlite.run('PRAGMA foreign_keys = ON')
  const migrations = new URL('../../drizzle/', import.meta.url)
  for (const name of readdirSync(migrations)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'))
  }
  const db = drizzle(sqlite, { schema })
  const now = new Date()
  // staff: a member with a password. tenant: portal access only. both: a member with portal
  // access. stranger: neither.
  for (const id of ['staff', 'tenant', 'both', 'stranger', 'admin']) {
    db.insert(schema.user)
      .values({
        id,
        name: id,
        email: `${id}@example.se`,
        emailVerified: true,
        role: id === 'admin' ? 'admin' : null,
      })
      .run()
  }
  const password = await hashPassword(PASSWORD)
  for (const id of ['staff', 'both', 'admin']) {
    db.insert(schema.account)
      .values({
        id: `acc-${id}`,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }
  db.insert(schema.organization)
    .values({ id: 'company', name: 'Bolaget', slug: 'bolaget', createdAt: now })
    .run()
  db.insert(schema.member)
    .values([
      { id: 'm-staff', organizationId: 'company', userId: 'staff', role: 'owner', createdAt: now },
      { id: 'm-both', organizationId: 'company', userId: 'both', role: 'admin', createdAt: now },
    ])
    .run()
  db.insert(schema.party)
    .values([
      { id: 'p-tenant', organizationId: 'company', kind: 'person', name: 'Hyresgäst' },
      { id: 'p-both', organizationId: 'company', kind: 'person', name: 'Ledamot' },
    ])
    .run()
  db.insert(schema.partyAccess)
    .values([
      { id: 'a-tenant', organizationId: 'company', partyId: 'p-tenant', userId: 'tenant' },
      { id: 'a-both', organizationId: 'company', partyId: 'p-both', userId: 'both' },
    ])
    .run()
  const emails: AnyEmail[] = []
  const auth = createAuth(db as unknown as Db, {
    secret: 'test-secret-for-workspace-integration-tests',
    baseURL: 'http://localhost:3000',
    deliverEmail: (email) => {
      emails.push(email)
    },
    recordCompanyEvent: async () => {},
    recordAdminEvent: async () => {},
    stripe: { client: new Stripe('sk_test_unused'), webhookSecret: '' },
    syncQuantity: async () => {},
  })
  const post = (path: string, body: object, headers: Record<string, string> = {}) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth/${path}`, {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    )
  /** The session cookie a sign-in response sets, to send with later requests. */
  const cookieOf = (response: Response) => {
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith('better-auth.session_token='))
    if (!cookie) throw new Error('no session cookie')
    return cookie.split(';')[0]
  }
  const sessions = (userId: string) =>
    sqlite
      .query('SELECT workspace, active_organization_id FROM session WHERE user_id = ?')
      .all(userId)
  const codeFor = (email: string) => {
    const sent = emails.filter((e) => e.to === email && e.template === 'signInCode').at(-1)
    return sent?.template === 'signInCode' ? sent.props.code : null
  }
  /** Signs in with a code (Mina sidor) or the password (the app) and returns the cookie. */
  const signIn = async (email: string, via: 'code' | 'password') => {
    if (via === 'password')
      return cookieOf(await post('sign-in/email', { email, password: PASSWORD }))
    await post('email-otp/send-verification-otp', { email, type: 'sign-in' })
    return cookieOf(await post('sign-in/email-otp', { email, otp: codeFor(email) }))
  }
  return { auth, post, sessions, codeFor, emails, sqlite, signIn }
}

test('an emailed code signs a tenant in to Mina sidor, never to a company', async () => {
  const f = await fixture()
  expect(
    (
      await f.post('email-otp/send-verification-otp', {
        email: 'tenant@example.se',
        type: 'sign-in',
      })
    ).status,
  ).toBe(200)
  const code = f.codeFor('tenant@example.se')
  expect(code).toMatch(/^\d{6}$/)
  const signedIn = await f.post('sign-in/email-otp', { email: 'tenant@example.se', otp: code })
  expect(signedIn.status).toBe(200)
  expect(f.sessions('tenant')).toEqual([{ workspace: 'portal', active_organization_id: null }])
})

test('a member with portal access gets a Mina sidor session from the code, an app session from the password', async () => {
  const f = await fixture()
  await f.post('email-otp/send-verification-otp', { email: 'both@example.se', type: 'sign-in' })
  await f.post('sign-in/email-otp', { email: 'both@example.se', otp: f.codeFor('both@example.se') })
  expect(
    (await f.post('sign-in/email', { email: 'both@example.se', password: PASSWORD })).status,
  ).toBe(200)
  expect(f.sessions('both')).toEqual(
    expect.arrayContaining([
      { workspace: 'portal', active_organization_id: null },
      { workspace: 'staff', active_organization_id: 'company' },
    ]),
  )
})

test('no code is sent to someone without portal access, and the answer is the same', async () => {
  const f = await fixture()
  for (const email of ['staff@example.se', 'stranger@example.se', 'nobody@example.se']) {
    const response = await f.post('email-otp/send-verification-otp', { email, type: 'sign-in' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  }
  expect(f.emails).toEqual([])
  // A code never creates an account either.
  expect(f.sqlite.query("SELECT id FROM user WHERE email = 'nobody@example.se'").all()).toEqual([])
})

test('a code for a member without portal access is refused at sign-in', async () => {
  const f = await fixture()
  const otp = await f.auth.api.createVerificationOTP({
    body: { email: 'staff@example.se', type: 'sign-in' },
  })
  const response = await f.post('sign-in/email-otp', { email: 'staff@example.se', otp })
  expect(response.status).toBe(403)
  expect(f.sessions('staff')).toEqual([])
})

test('revoked access stops the code sign-in', async () => {
  const f = await fixture()
  await f.post('email-otp/send-verification-otp', { email: 'tenant@example.se', type: 'sign-in' })
  const code = f.codeFor('tenant@example.se')
  f.sqlite.exec(`UPDATE party_access SET revoked_at = 1 WHERE id = 'a-tenant'`)
  expect(
    (await f.post('sign-in/email-otp', { email: 'tenant@example.se', otp: code })).status,
  ).toBe(403)
})

test('a request cannot choose its workspace', async () => {
  const f = await fixture()
  await f.post('sign-in/email', {
    email: 'staff@example.se',
    password: PASSWORD,
    workspace: 'portal',
  })
  expect(f.sessions('staff')).toEqual([{ workspace: 'staff', active_organization_id: 'company' }])
})

test('codes are for signing in only: resets, verification and email changes by code are off', async () => {
  const f = await fixture()
  for (const path of [
    'email-otp/request-password-reset',
    'email-otp/reset-password',
    'forget-password/email-otp',
    'email-otp/verify-email',
    'email-otp/check-verification-otp',
  ]) {
    expect(
      (await f.post(path, { email: 'tenant@example.se', otp: '000000', password: 'x' })).status,
    ).toBe(404)
  }
  await f.post('email-otp/send-verification-otp', {
    email: 'tenant@example.se',
    type: 'forget-password',
  })
  expect(f.emails).toEqual([])
})

test('a Mina sidor session is refused company, team and admin endpoints; the same person in the app is not', async () => {
  const f = await fixture()
  const portal = await f.signIn('both@example.se', 'code')
  const invite = { email: 'new@example.se', role: 'member', organizationId: 'company' }
  expect((await f.post('organization/invite-member', invite, { cookie: portal })).status).toBe(403)
  expect(
    (await f.post('organization/set-active', { organizationId: 'company' }, { cookie: portal }))
      .status,
  ).toBe(403)
  const app = await f.signIn('both@example.se', 'password')
  expect((await f.post('organization/invite-member', invite, { cookie: app })).status).toBe(200)
})

test('an admin acts as a user in Mina sidor only when asked, and only with portal access', async () => {
  const f = await fixture()
  const admin = await f.signIn('admin@example.se', 'password')
  const asPortal = { cookie: admin, 'x-fastighet-workspace': 'portal' }
  expect((await f.post('admin/impersonate-user', { userId: 'tenant' }, asPortal)).status).toBe(200)
  expect(f.sessions('tenant')).toEqual([{ workspace: 'portal', active_organization_id: null }])
  expect(
    (await f.post('admin/impersonate-user', { userId: 'staff' }, { cookie: admin })).status,
  ).toBe(200)
  expect(f.sessions('staff')).toEqual([{ workspace: 'staff', active_organization_id: 'company' }])
  // No portal access: no Mina sidor session.
  expect((await f.post('admin/impersonate-user', { userId: 'staff' }, asPortal)).status).toBe(403)
})
