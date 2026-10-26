import type { Period } from '#/features/invoicing/rules'
import { maxDate } from '#/lib/dates'
import { type Charge, invoiceLines, totalsOf } from './charges'
import { invoiceRecipient, type Party } from './parties'
import { type Dated, inForce, overlapsPeriod } from './periods'

// Pure rule for one avi: what an agreement bills for a period and to whom. Shared by invoice
// runs, corrected avier and the seed.

export interface BillableAgreement {
  readonly startDate: string
  readonly endDate: string | null
  readonly charges: readonly Charge[]
  readonly parties: readonly (Party & Dated)[]
  readonly units: readonly (Dated & { unitId?: string; designation: string; label: string })[]
}

/**
 * The avi for `period`: lines from the charges, the units that apply in the period, and the
 * parties in force on its first billed day as recipients. Null when there is nothing to bill
 * (no lines, or a total that isn't positive).
 */
export function billFor(
  agreement: BillableAgreement,
  period: Period,
  billedOnce: ReadonlySet<string>,
) {
  const on = maxDate(period.start, agreement.startDate)
  const parties = inForce(agreement.parties, on)
  const recipients =
    parties.length > 0 ? parties : agreement.parties.filter((p) => overlapsPeriod(p, period))
  if (recipients.length === 0) return null
  const units = agreement.units.filter((u) => overlapsPeriod(u, period))
  const lines = invoiceLines(agreement.charges, agreement, units, period, billedOnce)
  const totals = totalsOf(lines)
  if (lines.length === 0 || totals.totalOre <= 0) return null
  return { recipient: invoiceRecipient(recipients), lines, ...totals }
}
