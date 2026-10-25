import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { m } from '#/paraglide/messages'
import type { AgreementKind } from './kinds'

/** "Avtal #12", or "Bostadsrätt #12" for a bostadsrätt. */
export const agreementNumberLabel = (kind: AgreementKind, number: number): string =>
  kind === 'tenant_ownership' ? m.ownership_number({ number }) : m.lease_number({ number })

/** A link to an agreement's own page: the lease page or the bostadsrätt page. */
export function AgreementLink({
  agreement,
  className,
  children,
}: {
  agreement: { id: string; kind: AgreementKind }
  className?: string
  children: ReactNode
}) {
  return agreement.kind === 'tenant_ownership' ? (
    <Link
      to="/ownerships/$ownershipId"
      params={{ ownershipId: agreement.id }}
      className={className}
    >
      {children}
    </Link>
  ) : (
    <Link to="/leases/$leaseId" params={{ leaseId: agreement.id }} className={className}>
      {children}
    </Link>
  )
}
