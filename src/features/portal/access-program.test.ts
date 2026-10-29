import { expect, test } from 'bun:test'
import { grantPresets } from '#/lib/managed-access'
import { fail, harness } from '#/test/harness'
import {
  invitePortalUser,
  portalAccessFor,
  resendPortalInvitation,
  revokePortalAccess,
  revokePortalInvitation,
} from './access-program'
import { hashInvitationCode } from './codes'

const origin = 'https://app.example.test'

function setup() {
  const h = harness()
  h.sqlite.exec(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES
      ('anna-u', 'Anna Andersson', 'anna@example.test', 1, 0, 0),
      ('boss', 'Boss', 'boss@example.test', 1, 0, 0);
  `)
  return h
}

/** The code in the latest emailed invitation link. */
const emailedCode = (h: ReturnType<typeof harness>) => {
  const text = h.outbox.at(-1)?.text ?? ''
  const match = /\/portal\/invitation\?code=([\w-]+)/.exec(text)
  if (!match) throw new Error('no invitation link in the email')
  return decodeURIComponent(match[1])
}

const storedHash = (h: ReturnType<typeof harness>, id: string) =>
  (
    h.sqlite.query('SELECT code_hash FROM portal_invitation WHERE id = ?').get(id) as {
      code_hash: string
    }
  ).code_hash

test('staff invite a party: an email with a link, the code stored only as a hash', async () => {
  const h = setup()
  const result = await h.run(
    invitePortalUser({ partyId: 'anna', email: ' Anna@Example.test ' }, origin),
  )
  expect(result.emailed).toBe(true)
  expect(h.outbox.at(-1)).toMatchObject({ to: 'anna@example.test', subject: 'Mina sidor hos Test' })
  const code = emailedCode(h)
  expect(storedHash(h, result.id)).toBe(await hashInvitationCode(code))
  expect(storedHash(h, result.id)).not.toContain(code)

  const access = await h.run(portalAccessFor('anna'))
  expect(access.users).toEqual([])
  expect(access.invitations).toMatchObject([{ email: 'anna@example.test', status: 'pending' }])
})

test('one pending invitation per address; revoking allows a new one', async () => {
  const h = setup()
  const first = await h.run(invitePortalUser({ partyId: 'anna', email: 'a@example.test' }, origin))
  expect(
    await fail(h.run(invitePortalUser({ partyId: 'anna', email: 'A@example.test' }, origin))),
  ).toContain('redan en inbjudan')
  await h.run(revokePortalInvitation(first.id))
  expect((await h.run(portalAccessFor('anna'))).invitations).toEqual([])
  await h.run(invitePortalUser({ partyId: 'anna', email: 'a@example.test' }, origin))
  // Another party can invite the same address.
  await h.run(invitePortalUser({ partyId: 'erik', email: 'a@example.test' }, origin))
})

test('an address that already has access is refused', async () => {
  const h = setup()
  h.sqlite.exec(
    `INSERT INTO party_access (id, organization_id, party_id, user_id) VALUES ('pa1', 'org', 'anna', 'anna-u')`,
  )
  const access = await h.run(portalAccessFor('anna'))
  expect(access.users).toMatchObject([{ id: 'pa1', name: 'Anna Andersson' }])
  expect(
    await fail(h.run(invitePortalUser({ partyId: 'anna', email: 'ANNA@example.test' }, origin))),
  ).toContain('redan tillgång')
})

test('resending gives an expired invitation a new code and 14 more days', async () => {
  const h = setup()
  const { id } = await h.run(invitePortalUser({ partyId: 'anna', email: 'a@example.test' }, origin))
  const oldHash = storedHash(h, id)
  h.sqlite.exec(`UPDATE portal_invitation SET expires_at = 0 WHERE id = '${id}'`)
  expect((await h.run(portalAccessFor('anna'))).invitations[0].status).toBe('expired')

  await h.run(resendPortalInvitation(id, origin))
  expect(storedHash(h, id)).not.toBe(oldHash)
  expect(storedHash(h, id)).toBe(await hashInvitationCode(emailedCode(h)))
  expect((await h.run(portalAccessFor('anna'))).invitations[0].status).toBe('pending')
})

test('a withdrawn or used invitation cannot be resent or withdrawn again', async () => {
  const h = setup()
  const { id } = await h.run(invitePortalUser({ partyId: 'anna', email: 'a@example.test' }, origin))
  await h.run(revokePortalInvitation(id))
  expect(await fail(h.run(resendPortalInvitation(id, origin)))).toContain('NotFound')
  expect(await fail(h.run(revokePortalInvitation(id)))).toContain('NotFound')
})

test('revoking access closes the link and keeps it as history', async () => {
  const h = setup()
  h.sqlite.exec(
    `INSERT INTO party_access (id, organization_id, party_id, user_id) VALUES ('pa1', 'org', 'anna', 'anna-u')`,
  )
  await h.run(revokePortalAccess('pa1'))
  expect((await h.run(portalAccessFor('anna'))).users).toEqual([])
  expect(h.sqlite.query('SELECT revoked_by FROM party_access WHERE id = ?').get('pa1')).toEqual({
    revoked_by: 'user',
  })
  expect(await fail(h.run(revokePortalAccess('pa1')))).toContain('redan borttagen')
})

test("another company's party is not found", async () => {
  const h = setup()
  h.sqlite.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('other', 'Annat', 'annat', 0);
    INSERT INTO party (id, organization_id, kind, name) VALUES ('stranger', 'other', 'person', 'X');
  `)
  expect(
    await fail(h.run(invitePortalUser({ partyId: 'stranger', email: 'x@example.test' }, origin))),
  ).toContain('NotFound')
  expect(await fail(h.run(portalAccessFor('stranger')))).toContain('NotFound')
})

test("a managing company's staff invite only when the grant lets them manage tenants", async () => {
  const h = setup()
  const asManager = (grant: (typeof grantPresets)[keyof typeof grantPresets]) =>
    h.runAs({
      user: 'boss',
      home: { id: 'mgr', name: 'Förvaltning', role: 'owner' },
      organization: { id: 'org', name: 'Test', role: 'owner', grant },
    })
  expect(
    await fail(
      asManager(grantPresets.readOnly)(
        invitePortalUser({ partyId: 'anna', email: 'a@example.test' }, origin),
      ),
    ),
  ).toContain('Forbidden')
  expect((await asManager(grantPresets.readOnly)(portalAccessFor('anna'))).invitations).toEqual([])
  const result = await asManager(grantPresets.full)(
    invitePortalUser({ partyId: 'anna', email: 'a@example.test' }, origin),
  )
  expect(result.emailed).toBe(true)
})
