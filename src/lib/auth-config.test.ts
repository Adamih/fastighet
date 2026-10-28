/// <reference types="bun" />
import { Database as Sqlite } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { makeSignature } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Effect } from 'effect'
import Stripe from 'stripe'
import type { Db } from '#/db'
import * as schema from '#/db/schema'
import { hasPermission, requirePermission } from '#/server/authorize'
import type { AnyEmail } from '#/server/mail/mailer'
import { CurrentOrganization, PermissionChecker } from '#/server/services'
import { type AdminEvent, type CompanyEvent, createAuth } from './auth-config'
import type { Permissions } from './permissions'

const connections: Sqlite[] = []
afterEach(() => {
  for (const sqlite of connections.splice(0)) sqlite.close()
})

async function fixture(actorRole = 'admin', targetRole = 'member') {
  const sqlite = new Sqlite(':memory:')
  connections.push(sqlite)
  sqlite.run('PRAGMA foreign_keys = ON')
  const migrations = new URL('../../drizzle/', import.meta.url)
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'))
  }
  const db = drizzle(sqlite, { schema })
  const now = new Date()
  for (const id of ['actor', 'target', 'outsider']) {
    db.insert(schema.user)
      .values({ id, name: id, email: `${id}@example.se`, emailVerified: true })
      .run()
  }
  for (const id of ['company', 'another-company']) {
    db.insert(schema.organization).values({ id, name: id, slug: id, createdAt: now }).run()
  }
  db.insert(schema.member)
    .values([
      { id: 'self', organizationId: 'company', userId: 'actor', role: actorRole, createdAt: now },
      {
        id: 'target',
        organizationId: 'company',
        userId: 'target',
        role: targetRole,
        createdAt: now,
      },
      {
        id: 'foreign',
        organizationId: 'another-company',
        userId: 'outsider',
        role: 'member',
        createdAt: now,
      },
    ])
    .run()
  const secret = 'test-secret-for-better-auth-integration-tests'
  const token = 'integration-session-token'
  db.insert(schema.session)
    .values({
      id: 'session',
      token,
      userId: 'actor',
      activeOrganizationId: 'company',
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: now,
    })
    .run()
  const events: CompanyEvent[] = []
  const adminEvents: AdminEvent[] = []
  const emails: AnyEmail[] = []
  const auth = createAuth(db as unknown as Db, {
    secret,
    baseURL: 'http://localhost:3000',
    deliverEmail: (email) => {
      emails.push(email)
    },
    recordCompanyEvent: async (event) => {
      events.push(event)
    },
    recordAdminEvent: async (event) => {
      adminEvents.push(event)
    },
    stripe: { client: new Stripe('sk_test_unused'), webhookSecret: '' },
    syncQuantity: async () => {},
  })
  const headers = new Headers({
    cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, secret)}`)}`,
    origin: 'http://localhost:3000',
    'content-type': 'application/json',
  })
  const post = (path: string, body: object, plugin = 'organization') =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth/${plugin ? `${plugin}/` : ''}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
  const target = () => db.query.member.findFirst({ where: eq(schema.member.id, 'target') }).sync()
  const checker: PermissionChecker['Service'] = {
    check: async (organizationId, permissions) =>
      (
        await auth.api.hasPermission({
          headers,
          body: { organizationId, permissions },
        })
      ).success,
  }
  const permissions = (requested: Permissions, organizationId = 'company', required = false) =>
    Effect.runPromise(
      (required ? requirePermission(requested) : hasPermission(requested)).pipe(
        Effect.provideService(PermissionChecker, checker),
        Effect.provideService(CurrentOrganization, {
          id: organizationId,
          name: organizationId,
          // Deliberately different: the adapter must ask Better Auth, not trust this role snapshot.
          role: 'owner',
          grant: null,
        }),
      ),
    )
  return { db, auth, headers, post, target, permissions, events, adminEvents, emails }
}

describe('Better Auth member endpoints', () => {
  test('admins can promote and demote ordinary members and remove them', async () => {
    const f = await fixture()
    for (const role of ['admin', 'member']) {
      expect((await f.post('update-member-role', { memberId: 'target', role })).status).toBe(200)
      expect(f.target()?.role).toBe(role)
    }
    expect((await f.post('remove-member', { memberIdOrEmail: 'target' })).status).toBe(200)
    expect(f.target()).toBeUndefined()
  })

  test('admins cannot grant ownership', async () => {
    const f = await fixture()
    expect((await f.post('update-member-role', { memberId: 'target', role: 'owner' })).status).toBe(
      403,
    )
    expect(f.target()?.role).toBe('member')
  })

  test.each([
    'owner',
    'owner,admin',
    'member,owner',
  ])('admins cannot modify or remove an owner (%p)', async (role) => {
    const f = await fixture('admin', role)
    expect((await f.post('update-member-role', { memberId: 'target', role: 'member' })).ok).toBe(
      false,
    )
    expect((await f.post('remove-member', { memberIdOrEmail: 'target' })).ok).toBe(false)
    expect(f.target()?.role).toBe(role)
  })

  test('owners can grant ownership, demote and remove another owner', async () => {
    const f = await fixture('owner')
    for (const role of ['owner', 'member', 'owner']) {
      expect((await f.post('update-member-role', { memberId: 'target', role })).status).toBe(200)
    }
    expect((await f.post('remove-member', { memberIdOrEmail: 'target' })).status).toBe(200)
  })

  test('the only owner cannot demote or remove themselves', async () => {
    const f = await fixture('owner')
    expect((await f.post('update-member-role', { memberId: 'self', role: 'member' })).ok).toBe(
      false,
    )
    expect((await f.post('remove-member', { memberIdOrEmail: 'self' })).ok).toBe(false)
  })

  test('members cannot change roles or remove members', async () => {
    const f = await fixture('member')
    expect((await f.post('update-member-role', { memberId: 'target', role: 'admin' })).ok).toBe(
      false,
    )
    expect((await f.post('remove-member', { memberIdOrEmail: 'target' })).ok).toBe(false)
    expect(f.target()?.role).toBe('member')
  })

  test('members outside the active company cannot be changed or removed', async () => {
    const f = await fixture()
    expect((await f.post('update-member-role', { memberId: 'foreign', role: 'admin' })).ok).toBe(
      false,
    )
    expect((await f.post('remove-member', { memberIdOrEmail: 'foreign' })).ok).toBe(false)
    expect(
      f.db.query.member.findFirst({ where: eq(schema.member.id, 'foreign') }).sync()?.role,
    ).toBe('member')
  })

  test.each([
    'owner',
    'admin',
    'member',
  ])('leaving is disabled for authenticated %p members', async (role) => {
    const f = await fixture(role, 'owner')
    expect((await f.auth.api.getSession({ headers: f.headers }))?.user.id).toBe('actor')
    expect((await f.post('leave', { organizationId: 'company' })).status).toBe(404)
    expect(
      f.db.query.member.findFirst({ where: eq(schema.member.id, 'self') }).sync(),
    ).toBeDefined()
  })
})

describe('Team changes for the audit log', () => {
  test('role changes and removals name the acting user from the request', async () => {
    const f = await fixture()
    await f.post('update-member-role', { memberId: 'target', role: 'admin' })
    await f.post('remove-member', { memberIdOrEmail: 'target' })
    expect(f.events).toEqual([
      {
        organization: { id: 'company', name: 'company' },
        actor: { id: 'actor', name: 'actor' },
        action: 'team.change_role',
        entityId: 'target',
        details: { name: 'target', role: 'admin', previousRole: 'member' },
      },
      {
        organization: { id: 'company', name: 'company' },
        actor: { id: 'actor', name: 'actor' },
        action: 'team.remove',
        entityId: 'target',
        details: { name: 'target', role: 'admin' },
      },
    ])
  })

  test('invitations and their withdrawal are recorded with the email and role', async () => {
    const f = await fixture()
    const invited = await f.post('invite-member', { email: 'ny@example.se', role: 'member' })
    expect(invited.status).toBe(200)
    const { id } = (await invited.json()) as { id: string }
    await f.post('cancel-invitation', { invitationId: id })
    expect(f.events.map((e) => [e.action, e.actor?.id, e.entityId, e.details])).toEqual([
      ['team.invite', 'actor', id, { email: 'ny@example.se', role: 'member' }],
      ['team.cancel_invitation', 'actor', id, { email: 'ny@example.se' }],
    ])
  })

  test('refused changes record nothing', async () => {
    const f = await fixture('member')
    await f.post('update-member-role', { memberId: 'target', role: 'admin' })
    await f.post('remove-member', { memberIdOrEmail: 'target' })
    expect(f.events).toEqual([])
  })
})

describe('Companies are never deleted', () => {
  test('not even by their owner, who may not and cannot', async () => {
    const f = await fixture('owner')
    f.db
      .insert(schema.property)
      .values({ id: 'p', organizationId: 'company', designation: 'Uppsala 1:1' })
      .run()
    const response = await f.post('delete', { organizationId: 'company' })
    expect(response.status).toBe(404)
    expect(
      f.db
        .select()
        .from(schema.organization)
        .all()
        .map((o) => o.id),
    ).toContain('company')
    expect(f.db.select().from(schema.property).all()).toHaveLength(1)
    expect(await f.permissions({ organization: ['delete'] })).toBe(false)
    expect(await f.permissions({ organization: ['update'] })).toBe(true)
  })
})

describe('Account settings', () => {
  test('a new email is approved from the current address before anything changes', async () => {
    const f = await fixture()
    const response = await f.post('change-email', { newEmail: 'ny@example.se' }, '')
    expect(response.status).toBe(200)
    expect(f.emails).toMatchObject([
      {
        to: 'actor@example.se',
        template: 'confirmEmailChange',
        props: { name: 'actor', newEmail: 'ny@example.se' },
      },
    ])
    const [actor] = f.db.select().from(schema.user).where(eq(schema.user.id, 'actor')).all()
    expect(actor.email).toBe('actor@example.se')
  })
})

describe('Admins and impersonation', () => {
  const makeAdmin = (f: Awaited<ReturnType<typeof fixture>>, id = 'actor') =>
    f.db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, id)).run()

  test('an admin can act as a user, which opens a marked session and is logged', async () => {
    const f = await fixture()
    makeAdmin(f)
    const response = await f.post('impersonate-user', { userId: 'outsider' }, 'admin')
    expect(response.status).toBe(200)
    const sessions = f.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, 'outsider'))
      .all()
    expect(sessions.map((s) => s.impersonatedBy)).toEqual(['actor'])
    // Like any session, it starts in the user's own company.
    expect(sessions[0].activeOrganizationId).toBe('another-company')
    expect(f.adminEvents).toEqual([
      {
        actor: { id: 'actor', name: 'actor' },
        action: 'impersonate',
        targetUserId: 'outsider',
        details: {},
      },
    ])
  })

  test('nobody else can, and admins are never impersonated', async () => {
    const f = await fixture()
    expect((await f.post('impersonate-user', { userId: 'outsider' }, 'admin')).status).toBe(403)
    makeAdmin(f)
    makeAdmin(f, 'target')
    expect((await f.post('impersonate-user', { userId: 'target' }, 'admin')).status).toBe(403)
    expect(f.adminEvents).toEqual([])
  })

  test('admins never set passwords, create, edit or delete users', async () => {
    const f = await fixture()
    makeAdmin(f)
    for (const path of ['set-user-password', 'create-user', 'remove-user', 'update-user']) {
      const response = await f.post(path, { userId: 'outsider', newPassword: 'x' }, 'admin')
      expect(response.status).toBe(404)
    }
  })
})

describe('Better Auth domain permission adapter', () => {
  test('checks fresh membership grants and requires every requested permission', async () => {
    const f = await fixture('member')
    expect(await f.permissions({ invoice: ['manage'] })).toBe(true)
    expect(await f.permissions({ invoice: ['manage'], settings: ['manage'] })).toBe(false)
    await expect(f.permissions({ settings: ['manage'] }, 'company', true)).rejects.toMatchObject({
      _tag: 'Forbidden',
    })
    f.db.update(schema.member).set({ role: 'admin' }).where(eq(schema.member.id, 'self')).run()
    expect(await f.permissions({ settings: ['manage'] })).toBe(true)
  })

  test('checks the explicitly selected company instead of the session’s active company', async () => {
    const f = await fixture('admin')
    f.db
      .insert(schema.member)
      .values({
        id: 'second-membership',
        organizationId: 'another-company',
        userId: 'actor',
        role: 'member',
        createdAt: new Date(),
      })
      .run()
    expect(await f.permissions({ settings: ['manage'] }, 'company')).toBe(true)
    expect(await f.permissions({ settings: ['manage'] }, 'another-company')).toBe(false)
    expect(await f.permissions({ invoice: ['manage'] }, 'another-company')).toBe(true)
    f.db.delete(schema.member).where(eq(schema.member.id, 'second-membership')).run()
    await expect(f.permissions({ invoice: ['read'] }, 'another-company')).rejects.toMatchObject({
      _tag: 'DatabaseError',
    })
  })
})
