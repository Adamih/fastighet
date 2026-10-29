import { expect, test } from 'bun:test'
import { harness } from '#/test/harness'
import { portalCompaniesOf } from './companies'

test('a person reaches each company where they have open access, as their parties there', async () => {
  const h = harness()
  h.sqlite.exec(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES
      ('t', 'T', 't@example.test', 1, 0, 0);
    INSERT INTO organization (id, name, slug, created_at) VALUES ('brf', 'Brf Annan', 'brf', 0);
    INSERT INTO organization_settings (organization_id, kind) VALUES ('brf', 'brf');
    INSERT INTO party (id, organization_id, kind, name) VALUES ('member', 'brf', 'person', 'T i Brf');
    INSERT INTO party_access (id, organization_id, party_id, user_id, revoked_at) VALUES
      ('a1', 'org', 'anna', 't', NULL),
      ('a2', 'org', 'erik', 't', NULL),
      ('a3', 'org', 'maja', 't', 1),
      ('a4', 'brf', 'member', 't', NULL);
  `)
  expect(await h.run(portalCompaniesOf('t'))).toEqual([
    { id: 'brf', name: 'Brf Annan', kind: 'brf', parties: [{ id: 'member', name: 'T i Brf' }] },
    {
      id: 'org',
      name: 'Test',
      kind: 'landlord',
      parties: [
        { id: 'anna', name: 'Anna' },
        { id: 'erik', name: 'Erik' },
      ],
    },
  ])
  expect(await h.run(portalCompaniesOf('user'))).toEqual([])
})
