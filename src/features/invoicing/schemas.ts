import { Schema } from 'effect'
import { IsoDate } from '#/lib/schemas'
import { isInvoiceMonth } from './rules'

const InvoiceMonth = Schema.String.check(
  Schema.makeFilter(isInvoiceMonth, { message: 'Välj en månad (ÅÅÅÅ-MM)' }),
)

export const InvoiceRunInput = Schema.Struct({ month: InvoiceMonth })

export const CreateInvoiceRunInput = Schema.Struct({
  month: InvoiceMonth,
  /** Email each invoice to tenants that have an email address. */
  send: Schema.Boolean,
})
export type CreateInvoiceRunInput = typeof CreateInvoiceRunInput.Type

export const invoiceFilters = ['all', 'unpaid', 'overdue', 'paid', 'void'] as const
export type InvoiceFilter = (typeof invoiceFilters)[number]

export const ListInvoicesInput = Schema.Struct({
  filter: Schema.Literals(invoiceFilters),
  leaseId: Schema.optional(Schema.String),
})
export type ListInvoicesInput = typeof ListInvoicesInput.Type

export const InvoiceIdInput = Schema.Struct({ invoiceId: Schema.String })

export const MarkPaidInput = Schema.Struct({ invoiceId: Schema.String, paidOn: IsoDate })
export type MarkPaidInput = typeof MarkPaidInput.Type
