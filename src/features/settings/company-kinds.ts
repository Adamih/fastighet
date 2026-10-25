import { m } from '#/paraglide/messages'

// Client-safe: the kind of company, chosen during onboarding and changeable in settings.

/** A landlord (fastighetsägare) or a housing cooperative (bostadsrättsförening, BRF). */
export const companyKinds = ['landlord', 'brf'] as const
export type CompanyKind = (typeof companyKinds)[number]

export const companyKindLabels: Record<CompanyKind, string> = {
  get landlord() {
    return m.company_kind_landlord()
  },
  get brf() {
    return m.company_kind_brf()
  },
}
