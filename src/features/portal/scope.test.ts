import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { PortalCompany } from '#/server/services'
import { harness } from '#/test/harness'
import { visibleAgreementIds } from './scope'

// The harness company 'org' has the parties anna, erik and maja.

function setup() {
  const h = harness()
  const agreementRow = (id: string, number: number, endDate: string | null) =>
    `('${id}', 'org', ${number}, 'lease', '2020-01-01', ${endDate ? `'${endDate}'` : 'NULL'}, 'monthly')`
  h.sqlite.exec(`
    INSERT INTO agreement (id, organization_id, number, kind, start_date, end_date, invoice_interval) VALUES
      ${agreementRow('running', 1, null)},
      ${agreementRow('ended-long-ago', 2, '2020-06-30')},
      ${agreementRow('ended-owing', 3, '2020-06-30')},
      ${agreementRow('ended-recently', 4, '2099-01-01')},
      ${agreementRow('eriks', 5, null)};
    INSERT INTO agreement_party (id, organization_id, agreement_id, party_id, role, receives_invoices, position, from_date) VALUES
      ('ap1', 'org', 'running', 'anna', 'tenant', 1, 1, '2020-01-01'),
      ('ap2', 'org', 'running', 'maja', 'co_tenant', 0, 2, '2020-01-01'),
      ('ap3', 'org', 'ended-long-ago', 'anna', 'tenant', 1, 1, '2020-01-01'),
      ('ap4', 'org', 'ended-owing', 'anna', 'tenant', 1, 1, '2020-01-01'),
      ('ap5', 'org', 'ended-recently', 'anna', 'tenant', 1, 1, '2020-01-01'),
      ('ap6', 'org', 'eriks', 'erik', 'tenant', 1, 1, '2020-01-01');
    INSERT INTO posting (id, organization_id, date, kind, description) VALUES
      ('po1', 'org', '2020-06-01', 'invoice', 'Avi 1');
    INSERT INTO ledger_entry (id, organization_id, posting_id, account, amount_ore, party_id, agreement_id) VALUES
      ('le1', 'org', 'po1', 'receivable', 50000, 'anna', 'ended-owing'),
      ('le2', 'org', 'po1', 'income', -50000, NULL, NULL);
  `)
  const as = (partyIds: string[]) =>
    h.run(
      visibleAgreementIds.pipe(
        Effect.provideService(PortalCompany, {
          id: 'org',
          name: 'Test',
          kind: 'landlord',
          tier: 'landlord_pro',
          parties: partyIds.map((id) => ({ id, name: id })),
          partyIds,
        }),
      ),
    )
  return { ...h, as }
}

test("a person sees their parties' agreements: running, owing, or ended within the window", async () => {
  const { as } = setup()
  expect((await as(['anna'])).sort()).toEqual(['ended-owing', 'ended-recently', 'running'])
})

test('a co-tenant sees the shared agreement, and nobody sees other parties’ agreements', async () => {
  const { as } = setup()
  expect(await as(['maja'])).toEqual(['running'])
  expect(await as(['erik'])).toEqual(['eriks'])
  expect(await as([])).toEqual([])
})

test('only the company in focus counts', async () => {
  const { as, sqlite } = setup()
  sqlite.exec(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('other', 'Annat', 'annat', 0);
    INSERT INTO party (id, organization_id, kind, name) VALUES ('stranger', 'other', 'person', 'X');
  `)
  expect(await as(['stranger'])).toEqual([])
})
