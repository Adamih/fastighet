// Client-safe enums and Swedish labels for tenants and leases.

export const tenantKinds = ['person', 'company'] as const
export type TenantKind = (typeof tenantKinds)[number]
export const tenantKindLabels: Record<TenantKind, string> = {
  person: 'Privatperson',
  company: 'Företag',
}

export const rentIntervals = ['monthly', 'yearly'] as const
export type RentInterval = (typeof rentIntervals)[number]
export const rentIntervalLabels: Record<RentInterval, string> = {
  monthly: 'per månad',
  yearly: 'per år',
}

export const invoiceIntervals = ['monthly', 'quarterly'] as const
export type InvoiceInterval = (typeof invoiceIntervals)[number]
export const invoiceIntervalLabels: Record<InvoiceInterval, string> = {
  monthly: 'Månadsvis',
  quarterly: 'Kvartalsvis',
}

export const leaseStatusLabels = {
  upcoming: 'Kommande',
  active: 'Gällande',
  terminated: 'Uppsagt',
  ended: 'Avslutat',
} as const
