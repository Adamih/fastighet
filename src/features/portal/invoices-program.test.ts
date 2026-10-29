import { expect, test } from 'bun:test'
import { createCreditNote } from '#/features/invoicing/credit-program'
import { markInvoicePaid } from '#/features/invoicing/payment-program'
import { getInvoice, listInvoices } from '#/features/invoicing/program'
import { createInvoiceRun } from '#/features/invoicing/run-program'
import { createLease } from '#/features/leases/program'
import { addMonths, stockholmDate } from '#/lib/dates'
import { fail, harness } from '#/test/harness'
import { asPortal } from '#/test/portal'
import { portalBalance, portalInvoice, portalInvoices } from './invoices-program'

const today = stockholmDate(Date.now())
const month = (n: number) => addMonths(`${today.slice(0, 7)}-01`, n).slice(0, 7)

/** Anna rents u1 with Erik as co-tenant; Maja rents the parking space alone. */
async function setup() {
  const h = harness()
  const lease = (tenantId: string, coTenantIds: string[], unitIds: string[], rentOre: number) =>
    h.run(
      createLease({
        tenantId,
        coTenantIds,
        invoiceRecipientId: null,
        unitIds,
        startDate: '2024-01-01',
        termEndDate: null,
        extensionMonths: null,
        noticePeriodMonths: 3,
        rentOre,
        rentInterval: 'monthly',
        invoiceInterval: 'monthly',
        vat: false,
      }),
    )
  await lease('anna', ['erik'], ['u1'], 900_000)
  await lease('maja', [], ['p1'], 50_000)
  await h.run(createInvoiceRun({ month: month(0), send: false }))
  const all = await h.run(listInvoices({ filter: 'all' }))
  const annas = all.find((i) => i.totalOre === 900_000)
  const majas = all.find((i) => i.totalOre === 50_000)
  if (!annas || !majas) throw new Error('missing avier')
  return { ...h, annas, majas }
}

test("a person sees their agreements' avier, co-tenants too, never someone else's", async () => {
  const h = await setup()
  const forAnna = await h.run(asPortal(['anna'])(portalInvoices))
  expect(forAnna.map((i) => i.id)).toEqual([h.annas.id])
  expect(forAnna[0]).toMatchObject({ title: 'Hyresavi', owedOre: 900_000, totalOre: 900_000 })
  // Erik is on the lease without receiving the avier: he sees them too.
  expect((await h.run(asPortal(['erik'])(portalInvoices))).map((i) => i.id)).toEqual([h.annas.id])
  expect((await h.run(asPortal(['maja'])(portalInvoices))).map((i) => i.id)).toEqual([h.majas.id])
  expect(await fail(h.run(asPortal(['anna'])(portalInvoice(h.majas.id))))).toContain('NotFound')
})

test('an avi shows how to pay it, and what was paid, matching the app', async () => {
  const h = await setup()
  const avi = await h.run(asPortal(['anna'])(portalInvoice(h.annas.id)))
  const staff = await h.run(getInvoice(h.annas.id))
  expect(avi).toMatchObject({
    number: staff.number,
    status: staff.status,
    owedOre: 900_000,
    pay: { bankgiro: '990-0002', ocr: staff.ocr },
    payments: [],
  })
  await h.run(markInvoicePaid({ invoiceId: h.annas.id, paidOn: today }))
  const paid = await h.run(asPortal(['anna'])(portalInvoice(h.annas.id)))
  expect(paid).toMatchObject({ status: 'paid', owedOre: 0, paidOre: 900_000 })
  expect(paid.payments).toMatchObject([{ date: today, kind: 'manual_payment', amountOre: 900_000 }])
})

test('the balance counts open avier and the credit balance', async () => {
  const h = await setup()
  expect(await h.run(asPortal(['anna'])(portalBalance))).toMatchObject({
    owedOre: 900_000,
    creditOre: 0,
    nextDue: { id: h.annas.id },
  })
  // Paid, then credited in full: the money goes to Anna's credit balance.
  await h.run(markInvoicePaid({ invoiceId: h.annas.id, paidOn: today }))
  await h.run(createCreditNote({ invoiceId: h.annas.id, kind: 'rest', reason: 'Fel hyra' }))
  expect(await h.run(asPortal(['anna'])(portalBalance))).toMatchObject({
    owedOre: 0,
    creditOre: 900_000,
    nextDue: null,
  })
  const avi = await h.run(asPortal(['anna'])(portalInvoice(h.annas.id)))
  expect(avi.creditNotes).toHaveLength(1)
})
