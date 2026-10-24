import { m } from '#/paraglide/messages'
// Client-safe enums and their labels for tenants and leases. Labels are getters, so each read
// follows the current language.

export const tenantKinds = ['person', 'company'] as const
export type TenantKind = (typeof tenantKinds)[number]
export const tenantKindLabels: Record<TenantKind, string> = {
  get person() {
    return m.tenant_kind_person()
  },
  get company() {
    return m.tenant_kind_company()
  },
}

export const rentIntervals = ['monthly', 'yearly'] as const
export type RentInterval = (typeof rentIntervals)[number]
export const rentIntervalLabels: Record<RentInterval, string> = {
  get monthly() {
    return m.rent_interval_monthly()
  },
  get yearly() {
    return m.rent_interval_yearly()
  },
}

export const invoiceIntervals = ['monthly', 'quarterly'] as const
export type InvoiceInterval = (typeof invoiceIntervals)[number]
export const invoiceIntervalLabels: Record<InvoiceInterval, string> = {
  get monthly() {
    return m.invoice_interval_monthly()
  },
  get quarterly() {
    return m.invoice_interval_quarterly()
  },
}

export const leaseStatusLabels = {
  get upcoming() {
    return m.lease_status_upcoming()
  },
  get active() {
    return m.lease_status_active()
  },
  get terminated() {
    return m.lease_status_terminated()
  },
  get ended() {
    return m.lease_status_ended()
  },
}
