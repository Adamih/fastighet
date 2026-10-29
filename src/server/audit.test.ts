import { expect, test } from 'bun:test'
import { auditValues, portalAuditValues } from './audit'

const context = {
  organizationId: 'org',
  user: { id: 'user', name: 'Anna' },
  actor: { id: 'home', name: 'Hem AB' },
}

test('a write records who did it, for which company, and the id it created', () => {
  expect(auditValues(context, { action: 'tenant.create' }, { id: 'p1' })).toMatchObject({
    organizationId: 'org',
    userId: 'user',
    userName: 'Anna',
    actorOrganizationId: 'home',
    action: 'tenant.create',
    entityId: 'p1',
    impersonatedById: null,
    impersonatedByName: null,
  })
})

test('a write by an admin acting as the user names the admin too', () => {
  const values = auditValues(
    { ...context, user: { ...context.user, impersonatedBy: { id: 'boss', name: 'Ada Admin' } } },
    { action: 'invoice.void', entityId: 'i1' },
  )
  expect(values).toMatchObject({
    userId: 'user',
    impersonatedById: 'boss',
    impersonatedByName: 'Ada Admin',
  })
})

test('a write from Mina sidor names the person and the party, and no actor company', () => {
  expect(
    portalAuditValues(
      {
        organizationId: 'org',
        user: { id: 'tenant-user', name: 'Anna' },
        party: { id: 'anna', name: 'Anna Svensson' },
      },
      { action: 'portal.accept', entityId: 'anna' },
    ),
  ).toMatchObject({
    organizationId: 'org',
    userId: 'tenant-user',
    userName: 'Anna',
    actorOrganizationId: null,
    actorOrganizationName: 'Anna Svensson',
    actorPartyId: 'anna',
    action: 'portal.accept',
    entityId: 'anna',
  })
})
