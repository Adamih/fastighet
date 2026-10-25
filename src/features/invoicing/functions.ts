import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import {
  createCreditNote,
  createInvoiceRun,
  emailCreditNote,
  emailInvoice,
  getCreditNote,
  getInvoice,
  listInvoices,
  markInvoicePaid,
  previewInvoiceRun,
  previewReissue,
  refundCreditNote,
  reissueInvoice,
  undoCreditNoteRefund,
  unmarkInvoicePaid,
  voidInvoice,
} from './program'
import {
  CreateCreditNoteInput,
  CreateInvoiceRunInput,
  CreditNoteIdInput,
  InvoiceIdInput,
  InvoiceRunInput,
  type ListInvoicesInput,
  ListInvoicesInput as ListInvoicesSchema,
  MarkPaidInput,
  RefundCreditNoteInput,
} from './schemas'

const std = validate

export const previewInvoiceRunFn = createServerFn({ method: 'GET' })
  .validator(std(InvoiceRunInput))
  .handler(({ data }) => runApp(previewInvoiceRun(data.month)))

export const createInvoiceRunFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...CreateInvoiceRunInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once(
        'createInvoiceRun',
        data,
        { invoice: ['manage'], lease: ['read'] },
        createInvoiceRun(data),
      ),
    ),
  )

export const listInvoicesFn = createServerFn({ method: 'GET' })
  .validator(std(ListInvoicesSchema))
  .handler(({ data }) => runApp(listInvoices(data)))

export const getInvoiceFn = createServerFn({ method: 'GET' })
  .validator(std(InvoiceIdInput))
  .handler(({ data }) => runApp(getInvoice(data.invoiceId)))

export const emailInvoiceFn = createServerFn({ method: 'POST' })
  .validator(std(InvoiceIdInput))
  .handler(({ data }) => runApp(emailInvoice(data.invoiceId)))

export const markInvoicePaidFn = createServerFn({ method: 'POST' })
  .validator(std(MarkPaidInput))
  .handler(({ data }) => runApp(markInvoicePaid(data)))

export const unmarkInvoicePaidFn = createServerFn({ method: 'POST' })
  .validator(std(InvoiceIdInput))
  .handler(({ data }) => runApp(unmarkInvoicePaid(data.invoiceId)))

export const voidInvoiceFn = createServerFn({ method: 'POST' })
  .validator(std(InvoiceIdInput))
  .handler(({ data }) => runApp(voidInvoice(data.invoiceId)))

export const createCreditNoteFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...CreateCreditNoteInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(once('createCreditNote', data, { invoice: ['manage'] }, createCreditNote(data))),
  )

export const getCreditNoteFn = createServerFn({ method: 'GET' })
  .validator(std(CreditNoteIdInput))
  .handler(({ data }) => runApp(getCreditNote(data.creditNoteId)))

export const emailCreditNoteFn = createServerFn({ method: 'POST' })
  .validator(std(CreditNoteIdInput))
  .handler(({ data }) => runApp(emailCreditNote(data.creditNoteId)))

export const refundCreditNoteFn = createServerFn({ method: 'POST' })
  .validator(std(RefundCreditNoteInput))
  .handler(({ data }) => runApp(refundCreditNote(data)))

export const undoCreditNoteRefundFn = createServerFn({ method: 'POST' })
  .validator(std(CreditNoteIdInput))
  .handler(({ data }) => runApp(undoCreditNoteRefund(data.creditNoteId)))

export const previewReissueFn = createServerFn({ method: 'GET' })
  .validator(std(InvoiceIdInput))
  .handler(({ data }) => runApp(previewReissue(data.invoiceId)))

export const reissueInvoiceFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...InvoiceIdInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once(
        'reissueInvoice',
        data,
        { invoice: ['manage'], lease: ['read'] },
        reissueInvoice(data.invoiceId),
      ),
    ),
  )

export const reissuePreviewQuery = (invoiceId: string) =>
  queryOptions({
    queryKey: ['invoices', 'reissue', invoiceId],
    queryFn: () => previewReissueFn({ data: { invoiceId } }),
  })

export const creditNoteQuery = (creditNoteId: string) =>
  queryOptions({
    queryKey: ['invoices', 'credit-notes', creditNoteId],
    queryFn: () => getCreditNoteFn({ data: { creditNoteId } }),
  })

export const invoicesQuery = (input: ListInvoicesInput) =>
  queryOptions({
    queryKey: ['invoices', 'list', input],
    queryFn: () => listInvoicesFn({ data: input }),
  })

export const invoiceQuery = (invoiceId: string) =>
  queryOptions({
    queryKey: ['invoices', invoiceId],
    queryFn: () => getInvoiceFn({ data: { invoiceId } }),
  })

export const invoiceRunPreviewQuery = (month: string) =>
  queryOptions({
    queryKey: ['invoices', 'preview', month],
    queryFn: () => previewInvoiceRunFn({ data: { month } }),
  })
