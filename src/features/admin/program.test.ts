import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { AdminAuth, AdminUser } from '#/server/services'
import { fail, harness } from '#/test/harness'
import {
  banUser,
  getCompany,
  getUser,
  listAdminEvents,
  listCompanies,
  listUsers,
  overview,
  setAdmin,
  setPlanOverride,
  unbanUser,
} from './program'

/** The harness with an admin ('boss') and a stub of Better Auth's admin endpoints. */
function setup() {
  const h = harness()
  const now = Date.now()
  h.sqlite.exec(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role) VALUES
      ('boss', 'Boss', 'boss@example.test', 1, ${now}, ${now}, 'admin'),
      ('other-admin', 'Annan admin', 'admin2@example.test', 1, ${now}, ${now}, 'admin');
    INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
      ('m0', 'org', 'user', 'owner', ${now});
  `)
  const calls: string[] = []
  const auth: AdminAuth['Service'] = {
    ban: async (id, reason, seconds) => {
      calls.push(`ban ${id} ${reason} ${seconds}`)
      h.sqlite.exec(`UPDATE user SET banned = 1 WHERE id = '${id}'`)
    },
    unban: async (id) => {
      calls.push(`unban ${id}`)
      h.sqlite.exec(`UPDATE user SET banned = 0 WHERE id = '${id}'`)
    },
    setAdmin: async (id, admin) => {
      calls.push(`role ${id} ${admin}`)
    },
    revokeSessions: async (id) => {
      calls.push(`revoke ${id}`)
    },
  }
  const asAdmin = <A, E, R>(program: Effect.Effect<A, E, R>) =>
    h.run(
      program.pipe(
        Effect.provideService(AdminUser, { id: 'boss', name: 'Boss', email: 'boss@example.test' }),
        Effect.provideService(AdminAuth, auth),
      ) as Effect.Effect<A, E, never>,
    )
  return { ...h, asAdmin, calls }
}

test('admins see every user and company, with their tier', async () => {
  const { asAdmin } = setup()
  const users = await asAdmin(listUsers('exam'))
  expect(users.map((u) => u.id).sort()).toEqual(['boss', 'other-admin', 'user'])
  const [user] = await asAdmin(listUsers('u@example'))
  expect(user).toMatchObject({ id: 'user', isAdmin: false, banned: false })
  expect(user.companies).toEqual([
    { userId: 'user', organizationId: 'org', name: 'Test', role: 'owner' },
  ])
  expect((await asAdmin(getUser('boss'))).isSelf).toBe(true)

  const [company] = await asAdmin(listCompanies('Te'))
  expect(company).toMatchObject({
    id: 'org',
    kind: 'landlord',
    tier: 'landlord_pro',
    members: 1,
    units: 3,
  })
  expect(await asAdmin(overview)).toMatchObject({ users: 3, companies: 1 })
  expect(await fail(asAdmin(getCompany('nope')))).toContain('NotFound')
})

test('a tier by agreement must fit the company’s type, and is logged', async () => {
  const { asAdmin } = setup()
  expect(
    await fail(asAdmin(setPlanOverride({ organizationId: 'org', tier: 'brf_plus' }))),
  ).toContain('bolagets typ')
  await asAdmin(setPlanOverride({ organizationId: 'org', tier: null }))
  expect(await asAdmin(getCompany('org'))).toMatchObject({ tier: 'landlord_free', override: null })
  await asAdmin(setPlanOverride({ organizationId: 'org', tier: 'landlord' }))
  expect((await asAdmin(getCompany('org'))).tier).toBe('landlord')

  const [latest] = await asAdmin(listAdminEvents)
  expect(latest).toMatchObject({
    actorName: 'Boss',
    action: 'set_plan',
    targetOrganizationName: 'Test',
    details: { tier: 'landlord', previous: '' },
  })
})

test('bans need a reason, never hit the admin or another admin, and are logged', async () => {
  const { asAdmin, calls } = setup()
  expect(await fail(asAdmin(banUser({ userId: 'boss', reason: 'x', days: null })))).toContain(
    'dig själv',
  )
  expect(
    await fail(asAdmin(banUser({ userId: 'other-admin', reason: 'x', days: null }))),
  ).toContain('administratörsbehörigheten')
  expect(await fail(asAdmin(banUser({ userId: 'user', reason: ' ', days: null })))).toContain(
    'varför',
  )
  await asAdmin(banUser({ userId: 'user', reason: 'Bedrägeri', days: 7 }))
  expect((await asAdmin(getUser('user'))).banned).toBe(true)
  expect(await fail(asAdmin(setAdmin({ userId: 'user', admin: true })))).toContain('Häv spärren')
  await asAdmin(unbanUser('user'))
  expect(await fail(asAdmin(setAdmin({ userId: 'boss', admin: false })))).toContain('dig själv')
  await asAdmin(setAdmin({ userId: 'user', admin: true }))
  expect(calls).toEqual(['ban user Bedrägeri 604800', 'unban user', 'role user true'])
  expect((await asAdmin(listAdminEvents)).map((e) => e.action)).toEqual([
    'set_role',
    'unban',
    'ban',
  ])
})
