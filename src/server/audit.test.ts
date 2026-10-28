import { expect, test } from 'bun:test'
import { auditValues } from './audit'

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
