import { Effect } from 'effect'
import { requireFeature } from '#/features/billing/program'
import { listInvoices } from '#/features/invoicing/program'
import { listPayments } from '#/features/payments/program'
import { listUnits } from '#/features/properties/program'
import { hasPermission, requireOwnCompany } from '#/server/authorize'
import { managedCompanies } from '#/server/focus'
import { CurrentOrganization, CurrentUser, HomeOrganization } from '#/server/services'

// "Alla bolag": the user's own company and every company they manage, side by side. Each
// company's figures come from its own programs run with that company in focus, so they follow
// the same permissions (the grant and the role there) as the company's own pages. Nothing here
// writes; actions happen inside one company.

/** How many rows each cross-company list shows; the figures count everything. */
const LIST_LIMIT = 50

const companySummary = Effect.gen(function* () {
  const company = yield* CurrentOrganization
  const overdue = (yield* hasPermission({ invoice: ['read'] }))
    ? yield* listInvoices({ filter: 'overdue' })
    : null
  const attention = (yield* hasPermission({ payment: ['read'] }))
    ? yield* listPayments('attention')
    : null
  const units = (yield* hasPermission({ property: ['read'] })) ? yield* listUnits : null
  return {
    id: company.id,
    name: company.name,
    managed: company.grant !== null,
    units: units?.length ?? null,
    overdue: overdue && {
      count: overdue.length,
      owedOre: overdue.reduce((s, i) => s + i.owedOre, 0),
      rows: overdue.map((i) => ({
        id: i.id,
        number: i.number,
        recipientName: i.recipientName,
        dueDate: i.dueDate,
        owedOre: i.owedOre,
        lastRemindedOn: i.lastRemindedOn,
      })),
    },
    attention: attention && {
      count: attention.length,
      amountOre: attention.reduce((s, p) => s + p.unallocatedOre, 0),
      rows: attention.map((p) => ({
        id: p.id,
        bookingDate: p.bookingDate,
        amountOre: p.unallocatedOre,
        payerName: p.payerName,
        reference: p.reference,
      })),
    },
  }
})

export const portfolio = Effect.gen(function* () {
  yield* requireOwnCompany
  yield* requireFeature('portfolio')
  const user = yield* CurrentUser
  const home = yield* HomeOrganization
  const companies = [{ ...home, grant: null }, ...(yield* managedCompanies(user.id, home))]
  const summaries = yield* Effect.forEach(
    companies,
    (company) => companySummary.pipe(Effect.provideService(CurrentOrganization, company)),
    { concurrency: 4 },
  )

  const company = (c: (typeof summaries)[number]) => ({
    id: c.id,
    name: c.name,
    managed: c.managed,
  })
  return {
    companies: summaries.map(({ overdue, attention, ...c }) => ({
      ...c,
      overdue: overdue && { count: overdue.count, owedOre: overdue.owedOre },
      attention: attention && { count: attention.count, amountOre: attention.amountOre },
    })),
    overdue: summaries
      .flatMap((c) => (c.overdue?.rows ?? []).map((row) => ({ ...row, company: company(c) })))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, LIST_LIMIT),
    attention: summaries
      .flatMap((c) => (c.attention?.rows ?? []).map((row) => ({ ...row, company: company(c) })))
      .sort((a, b) => a.bookingDate.localeCompare(b.bookingDate))
      .slice(0, LIST_LIMIT),
  }
}).pipe(Effect.withSpan('portfolio.portfolio'))
