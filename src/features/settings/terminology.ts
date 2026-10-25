import type { AgreementKind } from '#/features/agreements/kinds'
import { m } from '#/paraglide/messages'
import type { CompanyKind } from './company-kinds'

// Pure wording rules. The company type decides how the app names its people; the agreement
// kind decides what a document is called, so a BRF's rental flats still get hyresavier.

/** UI wording that follows the company type. */
export function companyTerms(kind: CompanyKind): { parties: string } {
  return { parties: kind === 'brf' ? m.nav_members() : m.nav_tenants() }
}

/**
 * Document wording by agreement kind. Printed avier and emails are Swedish documents, so these
 * are Swedish literals rather than messages.
 */
export function documentTerms(kind: AgreementKind) {
  return kind === 'tenant_ownership'
    ? { invoiceTitle: 'Avgiftsavi', charge: 'Avgift' }
    : { invoiceTitle: 'Hyresavi', charge: 'Hyra' }
}
