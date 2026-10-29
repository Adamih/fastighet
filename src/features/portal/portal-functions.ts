import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { portalContext, runPortal } from '#/server/portal'
import { validate } from '#/server/validate'
import { portalAgreement, portalAgreements } from './agreements-program'
import { portalApartments, portalExtract } from './apartment-program'
import { portalContact, updatePortalContact } from './contact-program'
import { portalBalance, portalInvoice, portalInvoices } from './invoices-program'
import { UpdatePortalContactInput } from './schemas'

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

export const portalAgreementsFn = createServerFn({ method: 'GET' }).handler(() =>
  runPortal(portalAgreements),
)

export const portalAgreementFn = createServerFn({ method: 'GET' })
  .validator(validate(Schema.Struct({ agreementId: Schema.String })))
  .handler(({ data }) => runPortal(portalAgreement(data.agreementId)))

export const portalAgreementsQuery = () =>
  queryOptions({ queryKey: ['portal', 'agreements'], queryFn: () => portalAgreementsFn() })

export const portalAgreementQuery = (agreementId: string) =>
  queryOptions({
    queryKey: ['portal', 'agreements', agreementId],
    queryFn: () => portalAgreementFn({ data: { agreementId } }),
  })

export const portalApartmentsFn = createServerFn({ method: 'GET' }).handler(() =>
  runPortal(portalApartments),
)

/**
 * An extract from the apartment register. Recorded in the audit log although it only reads, so
 * the page fetches it from the component when asked for, never from a route loader (hover
 * preloading would record one).
 */
export const portalExtractFn = createServerFn({ method: 'GET' })
  .validator(validate(Schema.Struct({ ownershipId: Schema.String })))
  .handler(({ data }) =>
    runPortal(portalExtract(data.ownershipId), (extract) => ({
      action: 'ownership.extract',
      entityId: data.ownershipId,
      partyId: extract.partyId,
    })),
  )

export const portalApartmentsQuery = () =>
  queryOptions({ queryKey: ['portal', 'apartments'], queryFn: () => portalApartmentsFn() })

export const portalContactFn = createServerFn({ method: 'GET' }).handler(() =>
  runPortal(portalContact),
)

export const updatePortalContactFn = createServerFn({ method: 'POST' })
  .validator(validate(UpdatePortalContactInput))
  .handler(({ data }) =>
    runPortal(updatePortalContact(data), {
      action: 'portal.update_contact',
      entityId: data.partyId,
      partyId: data.partyId,
    }),
  )

export const portalContactQuery = () =>
  queryOptions({ queryKey: ['portal', 'contact'], queryFn: () => portalContactFn() })
