import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { portalContext, runPortal } from '#/server/portal'
import { validate } from '#/server/validate'
import { portalBalance, portalInvoice, portalInvoices } from './invoices-program'

// Server functions for the signed-in person in Mina sidor. Everything runs through `runPortal`
// (or `portalContext`), never `runApp`. Query keys start with 'portal' and don't name the
// company: the router drops cached data when the company in focus changes.

export const getPortalContextFn = createServerFn({ method: 'GET' }).handler(() => portalContext())

export const portalInvoicesFn = createServerFn({ method: 'GET' }).handler(() =>
  runPortal(portalInvoices),
)

export const portalInvoiceFn = createServerFn({ method: 'GET' })
  .validator(validate(Schema.Struct({ invoiceId: Schema.String })))
  .handler(({ data }) => runPortal(portalInvoice(data.invoiceId)))

export const portalBalanceFn = createServerFn({ method: 'GET' }).handler(() =>
  runPortal(portalBalance),
)

export const portalInvoicesQuery = () =>
  queryOptions({ queryKey: ['portal', 'invoices'], queryFn: () => portalInvoicesFn() })

export const portalInvoiceQuery = (invoiceId: string) =>
  queryOptions({
    queryKey: ['portal', 'invoices', invoiceId],
    queryFn: () => portalInvoiceFn({ data: { invoiceId } }),
  })

export const portalBalanceQuery = () =>
  queryOptions({ queryKey: ['portal', 'balance'], queryFn: () => portalBalanceFn() })
