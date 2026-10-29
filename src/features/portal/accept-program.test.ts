import { expect, test } from 'bun:test'
import { fail, harness } from '#/test/harness'
import { acceptPortalInvitation, previewPortalInvitation } from './accept-program'
import { invitePortalUser } from './access-program'

const origin = 'https://app.example.test'

/** Invites `email` to Anna's pages and returns the code from the emailed link. */
async function invite(h: ReturnType<typeof harness>, email: string, partyId = 'anna') {
  await h.run(invitePortalUser({ partyId, email }, origin))
  const match = /code=([\w-]+)/.exec(h.outbox.at(-1)?.text ?? '')
  if (!match) throw new Error('no link')
  return decodeURIComponent(match[1])
}

const access = (h: ReturnType<typeof harness>) =>
  h.sqlite
    .query('SELECT party_id, user_id, revoked_at FROM party_access ORDER BY created_at')
    .all() as { party_id: string; user_id: string; revoked_at: number | null }[]

test('the invitation page shows who invites and for whom', async () => {
  const h = harness()
  const code = await invite(h, 'anna@example.test')
  expect(await h.run(previewPortalInvitation(code))).toEqual({
    ok: true,
    organizationName: 'Test',
    partyName: 'Anna',
    email: 'anna@example.test',
  })
  expect(await h.run(previewPortalInvitation('nonsense'))).toMatchObject({ ok: false })
})

test('accepting creates a verified account without a password and gives access', async () => {
  const h = harness()
  const code = await invite(h, 'anna@example.test')
  const accepted = await h.run(acceptPortalInvitation(code, null))
  expect(accepted).toMatchObject({ email: 'anna@example.test', organizationId: 'org' })
  expect(
    h.sqlite.query('SELECT name, email_verified FROM user WHERE id = ?').get(accepted.userId),
  ).toEqual({ name: 'Anna', email_verified: 1 })
  expect(h.sqlite.query('SELECT * FROM account WHERE user_id = ?').all(accepted.userId)).toEqual([])
  expect(access(h)).toEqual([{ party_id: 'anna', user_id: accepted.userId, revoked_at: null }])
  // Used once.
  expect(await fail(h.run(acceptPortalInvitation(code, null)))).toContain('redan använd')
  expect(await h.run(previewPortalInvitation(code))).toMatchObject({ ok: false })
})

test('an existing account (e.g. a member of a company) gets access too, and is not duplicated', async () => {
  const h = harness()
  // 'user' (u@example.test) is the harness company's own member.
  const code = await invite(h, 'U@example.test')
  const accepted = await h.run(acceptPortalInvitation(code, 'u@example.test'))
  expect(accepted.userId).toBe('user')
  expect(
    h.sqlite.query("SELECT count(*) AS n FROM user WHERE email = 'u@example.test'").get(),
  ).toEqual({
    n: 1,
  })
  expect(access(h)).toEqual([{ party_id: 'anna', user_id: 'user', revoked_at: null }])
})

test('someone signed in as another address cannot accept', async () => {
  const h = harness()
  const code = await invite(h, 'anna@example.test')
  expect(await fail(h.run(acceptPortalInvitation(code, 'u@example.test')))).toContain(
    'Logga ut först',
  )
  expect(access(h)).toEqual([])
})

test('expired and withdrawn invitations are refused', async () => {
  const h = harness()
  const code = await invite(h, 'anna@example.test')
  h.sqlite.exec('UPDATE portal_invitation SET expires_at = 0')
  expect(await fail(h.run(acceptPortalInvitation(code, null)))).toContain('gått ut')
  h.sqlite.exec('UPDATE portal_invitation SET revoked_at = 1')
  expect(await fail(h.run(acceptPortalInvitation(code, null)))).toContain('dragits tillbaka')
})

test('one account can be invited to several parties', async () => {
  const h = harness()
  const accepted = await h.run(acceptPortalInvitation(await invite(h, 'a@example.test'), null))
  await h.run(acceptPortalInvitation(await invite(h, 'a@example.test', 'erik'), null))
  expect(access(h).map((a) => [a.party_id, a.user_id])).toEqual([
    ['anna', accepted.userId],
    ['erik', accepted.userId],
  ])
})
