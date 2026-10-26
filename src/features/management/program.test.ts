import { expect, test } from 'bun:test'
import { portfolio } from '#/features/portfolio/program'
import { createProperty, listProperties } from '#/features/properties/program'
import { getTeam } from '#/features/team/program'
import { grantPresets, levelsFromGrant } from '#/lib/managed-access'
import { recordAudit } from '#/server/audit'
import { managedCompanies, resolveFocus } from '#/server/focus'
import { fail, harness } from '#/test/harness'
import {
  acceptRequest,
  assignStaff,
  endClient,
  listClients,
  listManagers,
  managerActivity,
  previewRequest,
  requestAccess,
  revokeGrant,
  updateGrant,
  withdrawRequest,
} from './program'

// The fixture company 'org' (Test, owner 'user') is the managed side. 'mgr' (Förvaltning) is a
// property manager: 'boss' is its owner, 'anna' and 'bo' members. 'other' is an unrelated
// company, and 'chain' is a company that 'org' itself manages.

const full = levelsFromGrant(grantPresets.full)
const finance = levelsFromGrant(grantPresets.finance)

function setup() {
  const h = harness()
  const now = Date.now()
  h.sqlite.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES
      ('mgr', 'Förvaltning', 'mgr', ${now}), ('other', 'Annat', 'other', ${now}),
      ('chain', 'Kedja', 'chain', ${now});
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES
      ('boss', 'Boss', 'boss@example.test', 1, ${now}, ${now}),
      ('anna-m', 'Anna', 'anna@example.test', 1, ${now}, ${now}),
      ('bo', 'Bo', 'bo@example.test', 1, ${now}, ${now}),
      ('stranger', 'Stranger', 'stranger@example.test', 1, ${now}, ${now});
    INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
      ('m0', 'org', 'user', 'owner', ${now}),
      ('m1', 'mgr', 'boss', 'owner', ${now}), ('m2', 'mgr', 'anna-m', 'member', ${now}),
      ('m3', 'mgr', 'bo', 'member', ${now}), ('m4', 'other', 'stranger', 'owner', ${now});
  `)
  const mgrHome = { id: 'mgr', name: 'Förvaltning', role: 'owner' }
  const asBoss = h.runAs({ user: 'boss', home: mgrHome })
  return { ...h, asBoss, mgrHome }
}

/** 'mgr' asks for access and 'org' approves it with `levels`. */
async function grantAccess(h: ReturnType<typeof setup>, levels = full) {
  const { code } = await h.asBoss(requestAccess({ label: 'Test', email: '', levels }, 'http://x'))
  return h.run(acceptRequest({ code, levels, processorAgreement: true }))
}

test('the manager asks, the managed owner sees who asks and approves', async () => {
  const h = setup()
  const created = await h.asBoss(
    requestAccess(
      { label: 'Brf Test', email: 'styrelse@example.test', levels: finance },
      'http://x',
    ),
  )
  expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
  expect(created.link).toBe(`http://x/management?code=${created.code}`)
  expect(created.emailed).toBe(true)
  expect(h.outbox[0]?.to).toBe('styrelse@example.test')
  expect(h.outbox[0]?.html).toContain(created.code)

  // Case, spaces and dashes don't matter.
  const typed = created.code.toLowerCase().replace('-', ' ')
  const preview = await h.run(previewRequest(typed))
  expect(preview).toMatchObject({
    managingName: 'Förvaltning',
    label: 'Brf Test',
    preset: 'finance',
  })

  // The owner decides: more than asked for here.
  const { grantId } = await h.run(
    acceptRequest({ code: typed, levels: full, processorAgreement: true }),
  )
  const [manager] = await h.run(listManagers)
  expect(manager).toMatchObject({ grantId, name: 'Förvaltning', preset: 'full', leaders: ['Boss'] })

  const clients = await h.asBoss(listClients)
  expect(clients.clients.map((c) => c.name)).toEqual(['Test'])
  expect(clients.requests[0]).toMatchObject({ status: 'used', usedBy: 'Test' })
})

test('a code works once, not after withdrawal, expiry or from the company itself', async () => {
  const h = setup()
  const first = await h.asBoss(requestAccess({ label: 'A', email: '', levels: full }, 'http://x'))
  expect(
    await fail(h.run(acceptRequest({ code: first.code, levels: full, processorAgreement: false }))),
  ).toContain('personuppgiftsbiträdesavtal')
  await h.run(acceptRequest({ code: first.code, levels: full, processorAgreement: true }))
  // Used, and a second company can't use it either.
  const asOther = h.runAs({ user: 'stranger', home: { id: 'other', name: 'Annat', role: 'owner' } })
  expect(await fail(asOther(previewRequest(first.code)))).toContain('Koden gäller inte')

  const withdrawn = await h.asBoss(
    requestAccess({ label: 'B', email: '', levels: full }, 'http://x'),
  )
  await h.asBoss(withdrawRequest(withdrawn.requestId))
  expect(await fail(asOther(previewRequest(withdrawn.code)))).toContain('Koden gäller inte')

  const expired = await h.asBoss(requestAccess({ label: 'C', email: '', levels: full }, 'http://x'))
  h.sqlite.exec(`UPDATE management_request SET expires_at = 1 WHERE id = '${expired.requestId}'`)
  expect(await fail(asOther(previewRequest(expired.code)))).toContain('Koden gäller inte')

  const own = await h.asBoss(requestAccess({ label: 'D', email: '', levels: full }, 'http://x'))
  expect(await fail(h.asBoss(previewRequest(own.code)))).toContain('ert eget bolag')

  // A manager with access can't be granted twice.
  const again = await h.asBoss(requestAccess({ label: 'E', email: '', levels: full }, 'http://x'))
  expect(await fail(h.run(previewRequest(again.code)))).toContain('har redan åtkomst')
})

test('wrong codes are limited', async () => {
  const h = setup()
  for (let i = 0; i < 10; i++) {
    expect(await fail(h.run(previewRequest('AAAAA-AAAAA')))).toContain('Koden gäller inte')
  }
  const { code } = await h.asBoss(
    requestAccess({ label: 'A', email: '', levels: full }, 'http://x'),
  )
  expect(await fail(h.run(previewRequest(code)))).toContain('För många')
})

test('who at the manager reaches the company, and with which role', async () => {
  const h = setup()
  await grantAccess(h)
  const boss = { id: 'mgr', name: 'Förvaltning', role: 'owner' }
  const member = { id: 'mgr', name: 'Förvaltning', role: 'member' }
  const focus = (user: string, home: typeof boss, company: string | null) =>
    h.run(resolveFocus(user, home, company))

  // Their own company when none is asked for.
  expect(await focus('anna-m', member, null)).toEqual({ ...member, grant: null })
  expect(await focus('anna-m', member, 'mgr')).toEqual({ ...member, grant: null })

  // Owners and admins without an assignment; members only once assigned.
  expect(await focus('boss', boss, 'org')).toMatchObject({ id: 'org', name: 'Test', role: 'owner' })
  expect(await fail(focus('anna-m', member, 'org'))).toContain('CompanyNotInScope')
  await h.asBoss(
    assignStaff({
      managedOrganizationId: 'org',
      staff: [
        { userId: 'anna-m', role: null },
        { userId: 'bo', role: 'viewer' },
      ],
    }),
  )
  expect(await focus('anna-m', member, 'org')).toMatchObject({ role: 'member' })
  expect(await focus('bo', member, 'org')).toMatchObject({ role: 'viewer' })

  // Unknown, unrelated or forged company ids give nothing.
  expect(await fail(focus('boss', boss, 'other'))).toContain('CompanyNotInScope')
  expect(await fail(focus('boss', boss, 'nope'))).toContain('CompanyNotInScope')
  // The manager's staff from another company, with the same id asked for.
  const stranger = { id: 'other', name: 'Annat', role: 'owner' }
  expect(await fail(focus('stranger', stranger, 'org'))).toContain('CompanyNotInScope')
})

test("grants don't chain", async () => {
  const h = setup()
  await grantAccess(h)
  // 'org' manages 'chain' too.
  const asChainOwner = h.runAs({ home: { id: 'chain', name: 'Kedja', role: 'owner' } })
  const { code } = await h.run(
    requestAccess({ label: 'Kedja', email: '', levels: full }, 'http://x'),
  )
  await asChainOwner(acceptRequest({ code, levels: full, processorAgreement: true }))

  expect(
    (await h.run(managedCompanies('user', { id: 'org', name: 'Test', role: 'owner' }))).map(
      (c) => c.id,
    ),
  ).toEqual(['chain'])
  const boss = { id: 'mgr', name: 'Förvaltning', role: 'owner' }
  expect((await h.run(managedCompanies('boss', boss))).map((c) => c.id)).toEqual(['org'])
  expect(await fail(h.run(resolveFocus('boss', boss, 'chain')))).toContain('CompanyNotInScope')

  // And from inside a managed company, its own management can't be reached.
  const managed = h.runAs({
    user: 'boss',
    home: boss,
    organization: { id: 'org', name: 'Test', role: 'owner', grant: grantPresets.full },
  })
  expect(await fail(managed(listClients))).toContain('Forbidden')
  expect(await fail(managed(listManagers))).toContain('Forbidden')
  expect(
    await fail(managed(requestAccess({ label: 'X', email: '', levels: full }, 'http://x'))),
  ).toContain('Forbidden')
})

test('revoking ends access at once; granting again brings the assignments back', async () => {
  const h = setup()
  const { grantId } = await grantAccess(h)
  await h.asBoss(
    assignStaff({ managedOrganizationId: 'org', staff: [{ userId: 'anna-m', role: null }] }),
  )
  const member = { id: 'mgr', name: 'Förvaltning', role: 'member' }

  await h.run(revokeGrant(grantId))
  expect(await fail(h.run(resolveFocus('anna-m', member, 'org')))).toContain('CompanyNotInScope')
  expect(await h.run(listManagers)).toEqual([])
  expect((await h.asBoss(listClients)).clients).toEqual([])
  expect(await fail(h.run(revokeGrant(grantId)))).toContain('NotFound')

  await grantAccess(h)
  expect(await h.run(resolveFocus('anna-m', member, 'org'))).toMatchObject({ id: 'org' })
})

test('changing a grant applies on the next request; only the managed company can', async () => {
  const h = setup()
  const { grantId } = await grantAccess(h)
  await h.run(updateGrant({ grantId, levels: finance }))
  const boss = { id: 'mgr', name: 'Förvaltning', role: 'owner' }
  expect((await h.run(resolveFocus('boss', boss, 'org'))).grant).toEqual(grantPresets.finance)

  const none = levelsFromGrant({})
  expect(await fail(h.run(updateGrant({ grantId, levels: none })))).toContain('återkalla')
  // The manager can't change or revoke the grant it was given.
  expect(await fail(h.asBoss(updateGrant({ grantId, levels: full })))).toContain('NotFound')
  expect(await fail(h.asBoss(revokeGrant(grantId)))).toContain('NotFound')
})

test('only the manager’s own members can be assigned, to companies it manages', async () => {
  const h = setup()
  await grantAccess(h)
  expect(
    await fail(
      h.asBoss(
        assignStaff({ managedOrganizationId: 'org', staff: [{ userId: 'stranger', role: null }] }),
      ),
    ),
  ).toContain('egna användare')
  expect(
    await fail(h.asBoss(assignStaff({ managedOrganizationId: 'other', staff: [] }))),
  ).toContain('NotFound')

  await h.asBoss(
    assignStaff({ managedOrganizationId: 'org', staff: [{ userId: 'bo', role: 'viewer' }] }),
  )
  const [client] = (await h.asBoss(listClients)).clients
  expect(client.assigned).toEqual([{ userId: 'bo', name: 'Bo', role: 'viewer' }])
  const [manager] = await h.run(listManagers)
  expect(manager.assigned).toEqual([{ name: 'Bo', role: 'viewer' }])

  // An empty list removes everyone.
  await h.asBoss(assignStaff({ managedOrganizationId: 'org', staff: [] }))
  expect((await h.asBoss(listClients)).clients[0].assigned).toEqual([])
})

test('domain programs follow the grant and the role in a managed company; the team stays private', async () => {
  const h = setup()
  const home = { id: 'mgr', name: 'Förvaltning', role: 'owner' }
  const as = (role: string, grant: typeof grantPresets.full) =>
    h.runAs({ user: 'boss', home, organization: { id: 'org', name: 'Test', role, grant } })
  const property = {
    designation: 'Uppsala 2:2',
    name: '',
    streetAddress: '',
    postalCode: '',
    city: '',
  }

  // Reads and writes run on the managed company's data.
  expect((await as('owner', grantPresets.full)(listProperties)).map((p) => p.designation)).toEqual([
    'Uppsala 1:1',
  ])
  await as('owner', grantPresets.full)(createProperty(property))
  expect(
    await fail(
      as(
        'owner',
        grantPresets.readOnly,
      )(createProperty({ ...property, designation: 'Uppsala 3:3' })),
    ),
  ).toContain('Forbidden')
  expect(
    await fail(
      as('viewer', grantPresets.full)(createProperty({ ...property, designation: 'Uppsala 3:3' })),
    ),
  ).toContain('Forbidden')
  expect(await fail(as('owner', grantPresets.full)(getTeam))).toContain('Forbidden')
  // In their own company the team is open as before.
  expect((await h.run(getTeam)).members.length).toBe(1)
})

test('the manager can end its own access; the client sees it in its log', async () => {
  const h = setup()
  const { grantId } = await grantAccess(h)
  // Only the manager's own grants, and only from its own company.
  const asOther = h.runAs({ user: 'stranger', home: { id: 'other', name: 'Annat', role: 'owner' } })
  expect(await fail(asOther(endClient(grantId)))).toContain('NotFound')

  await h.asBoss(endClient(grantId))
  expect(await h.run(listManagers)).toEqual([])
  expect(await fail(h.asBoss(endClient(grantId)))).toContain('NotFound')
  const [event] = await h.run(managerActivity)
  expect(event).toMatchObject({
    action: 'management.end_client',
    userName: 'boss',
    companyName: 'Förvaltning',
  })
})

test("the log lists what other companies' staff did, not the company's own changes", async () => {
  const h = setup()
  await grantAccess(h)
  const actor = { id: 'mgr', name: 'Förvaltning' }
  const own = { id: 'org', name: 'Test' }
  const write = (who: typeof actor, action: 'invoice.void' | 'lease.update', entityId: string) =>
    h.run(
      recordAudit(
        { organizationId: 'org', user: { id: 'boss', name: 'Boss' }, actor: who },
        { action, entityId },
        undefined,
      ),
    )
  h.sqlite.exec(
    `INSERT INTO agreement (id, organization_id, kind, number, start_date, invoice_interval) VALUES ('a1', 'org', 'lease', 1, '2024-01-01', 'monthly')`,
  )
  await write(actor, 'invoice.void', 'i1')
  await write(actor, 'lease.update', 'a1')
  await write(own, 'invoice.void', 'i2')
  const events = await h.run(managerActivity)
  expect(events.map((e) => [e.action, e.entityId, e.companyName, e.agreementKind])).toEqual([
    ['lease.update', 'a1', 'Förvaltning', 'lease'],
    ['invoice.void', 'i1', 'Förvaltning', null],
  ])
  // The created id is used when none is given.
  await h.run(
    recordAudit(
      { organizationId: 'org', user: { id: 'boss', name: 'Boss' }, actor },
      { action: 'property.create' },
      { id: 'p9' },
    ),
  )
  expect((await h.run(managerActivity))[0]).toMatchObject({
    action: 'property.create',
    entityId: 'p9',
  })
  // A manager can't read the client's log from inside it.
  const managed = h.runAs({
    user: 'boss',
    home: { id: 'mgr', name: 'Förvaltning', role: 'owner' },
    organization: { id: 'org', name: 'Test', role: 'owner', grant: grantPresets.full },
  })
  expect(await fail(managed(managerActivity))).toContain('Forbidden')
})

test('all companies: each company with the permissions that apply there', async () => {
  const h = setup()
  const { grantId } = await grantAccess(h)
  const overview = await h.asBoss(portfolio)
  expect(overview.companies.map((c) => [c.name, c.managed, c.units])).toEqual([
    ['Förvaltning', false, 0],
    ['Test', true, 3],
  ])
  expect(overview.companies[1].overdue).toEqual({ count: 0, owedOre: 0 })

  // Only properties granted: no avier or payments for that company.
  await h.run(updateGrant({ grantId, levels: { ...levelsFromGrant({}), property: 'read' } }))
  const narrowed = await h.asBoss(portfolio)
  expect(narrowed.companies[1]).toMatchObject({ units: 3, overdue: null, attention: null })

  // A member who isn't assigned sees only their own company.
  const asAnna = h.runAs({
    user: 'anna-m',
    home: { id: 'mgr', name: 'Förvaltning', role: 'member' },
  })
  expect((await asAnna(portfolio)).companies.map((c) => c.name)).toEqual(['Förvaltning'])
})
