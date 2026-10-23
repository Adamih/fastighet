import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import {
  assignPayment,
  ignorePayment,
  importPayments,
  listOpenInvoices,
  listPaymentImports,
  listPayments,
  undoPayment,
} from './program'
import {
  AssignPaymentInput,
  ImportPaymentsInput,
  ListPaymentsInput,
  type PaymentFilter,
  PaymentIdInput,
} from './schemas'

const std = Schema.toStandardSchemaV1

export const importPaymentsFn = createServerFn({ method: 'POST' })
  .validator(std(ImportPaymentsInput))
  .handler(({ data }) => runApp(importPayments(data)))

export const listPaymentsFn = createServerFn({ method: 'GET' })
  .validator(std(ListPaymentsInput))
  .handler(({ data }) => runApp(listPayments(data.filter)))

export const listPaymentImportsFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(listPaymentImports),
)

export const listOpenInvoicesFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(listOpenInvoices),
)

export const assignPaymentFn = createServerFn({ method: 'POST' })
  .validator(std(AssignPaymentInput))
  .handler(({ data }) => runApp(assignPayment(data)))

export const ignorePaymentFn = createServerFn({ method: 'POST' })
  .validator(std(PaymentIdInput))
  .handler(({ data }) => runApp(ignorePayment(data.paymentId)))

export const undoPaymentFn = createServerFn({ method: 'POST' })
  .validator(std(PaymentIdInput))
  .handler(({ data }) => runApp(undoPayment(data.paymentId)))

export const paymentsQuery = (filter: PaymentFilter) =>
  queryOptions({
    queryKey: ['payments', 'list', filter],
    queryFn: () => listPaymentsFn({ data: { filter } }),
  })

export const paymentImportsQuery = () =>
  queryOptions({ queryKey: ['payments', 'imports'], queryFn: () => listPaymentImportsFn() })

export const openInvoicesQuery = () =>
  queryOptions({ queryKey: ['invoices', 'open'], queryFn: () => listOpenInvoicesFn() })
