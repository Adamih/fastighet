import { isValidBankgiro, vatNumberFor } from '#/features/invoicing/rules'
import { isValidOrganizationNumber } from '#/features/tenants/organization-number'
import { m } from '#/paraglide/messages'

// Pure rules for the seller details printed on invoices. Shared by the server (emails and
// printed invoices) and the settings page (preview and readiness check).

export interface SellerDetails {
  readonly organizationName: string
  readonly organizationNumber: string | null
  readonly streetAddress: string | null
  readonly postalCode: string | null
  readonly city: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly fSkatt: boolean
}

/** Seller details for the footer of the email and the printed invoice. */
export function sellerDetails(seller: SellerDetails, hasVat: boolean): string[] {
  const address = [seller.streetAddress, [seller.postalCode, seller.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const ids = [
    seller.organizationNumber && `Org.nr ${seller.organizationNumber}`,
    hasVat && seller.organizationNumber && `Momsreg.nr ${vatNumberFor(seller.organizationNumber)}`,
    seller.fSkatt && 'Godkänd för F-skatt',
  ].filter(Boolean)
  return [
    [seller.organizationName, address].filter(Boolean).join(', '),
    ids.join(' · '),
    [seller.email, seller.phone].filter(Boolean).join(' · '),
  ].filter(Boolean)
}

/** The settings form as typed: every text field is a string, possibly blank. */
export interface SettingsDraft {
  readonly organizationNumber: string
  readonly bankgiro: string
  readonly streetAddress: string
  readonly postalCode: string
  readonly city: string
  readonly email: string
}

export interface ReadinessItem {
  readonly key: 'bankgiro' | 'organizationNumber' | 'address' | 'email'
  readonly done: boolean
  /** Why it matters, shown when it's the first thing missing. */
  readonly missing: string
}

const filled = (value: string) => value.trim() !== ''

/** What invoices need from the settings, most important first. */
export function settingsReadiness(draft: SettingsDraft): ReadinessItem[] {
  return [
    {
      key: 'bankgiro',
      done: isValidBankgiro(draft.bankgiro),
      missing: m.settings_missing_bankgiro(),
    },
    {
      key: 'organizationNumber',
      done: isValidOrganizationNumber(draft.organizationNumber),
      missing: m.settings_missing_organization_number(),
    },
    {
      key: 'address',
      done: filled(draft.streetAddress) && filled(draft.postalCode) && filled(draft.city),
      missing: m.settings_missing_address(),
    },
    {
      key: 'email',
      done: filled(draft.email),
      missing: m.settings_missing_email(),
    },
  ]
}
