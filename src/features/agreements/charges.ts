import {
  type Period,
  periodLabel,
  rentForPeriod,
  VAT_RATE_PERCENT,
  vatFor,
} from '#/features/invoicing/rules'
import { maxDate, minDate } from '#/lib/dates'
import type { AgreementKind, ChargeInterval, ChargeKind } from './kinds'
import { type Dated, dayBefore, inForceOn, overlapsPeriod } from './periods'

// Pure rules for charges: what an agreement bills, from when. Shared by the server (invoice runs
// and changes) and the UI (previews). Client-safe.

export interface Charge extends Dated {
  readonly id: string
  readonly kind: ChargeKind
  /** The unit an add-on is for; the base line then leaves it out. */
  readonly unitId: string | null
  /** Shown on the avi; null uses the kind's standard text. */
  readonly description: string | null
  /** Per interval; for `once`, the whole amount (negative for a reduction). */
  readonly amountOre: number
  readonly interval: ChargeInterval
  readonly vat: boolean
}

/** The base charge for an agreement kind: rent for a lease, the fee for a bostadsrätt. */
export const baseKindOf = (kind: AgreementKind): ChargeKind =>
  kind === 'tenant_ownership' ? 'fee' : 'rent'

export const isBaseKind = (kind: ChargeKind) => kind === 'rent' || kind === 'fee'

/**
 * The base charge to show as "the rent": the one in force on `on`, else the next to start, else
 * the last one. Null when there is none.
 */
export function currentBaseCharge<C extends Charge>(charges: readonly C[], on: string): C | null {
  const base = charges
    .filter((c) => isBaseKind(c.kind))
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate))
  return (
    base.find((c) => inForceOn(c, on)) ?? base.find((c) => c.fromDate > on) ?? base.at(-1) ?? null
  )
}

/** Avi line texts. Printed avier are Swedish documents, so these are Swedish literals. */
const lineLabels: Record<ChargeKind, string> = {
  rent: 'Hyra',
  fee: 'Avgift',
  parking: 'Parkering',
  storage: 'Förråd',
  utility: 'Förbrukning',
  index: 'Indextillägg',
  one_off: 'Engångsbelopp',
  other: 'Övrigt',
  reminder_fee: 'Påminnelseavgift',
}

export interface LineUnit {
  readonly unitId?: string
  readonly designation: string
  readonly label: string
}

/**
 * "Hyra Uppsala Kungsängen 12:3 · 1001, december 2026", "Parkering P4, december 2026",
 * "Parkering: Garage, december 2026". The base line lists the units it covers.
 */
export function lineDescription(
  charge: Pick<Charge, 'kind' | 'description' | 'interval' | 'unitId'>,
  units: readonly LineUnit[],
  period: Period,
): string {
  if (charge.interval === 'once') return charge.description ?? lineLabels[charge.kind]
  const own = units.find((u) => charge.unitId && u.unitId === charge.unitId)
  const what = isBaseKind(charge.kind)
    ? `${lineLabels[charge.kind]} ${units
        .map((u) => `${u.designation} · ${u.label}`)
        .sort()
        .join(', ')}`
    : charge.description
      ? `${lineLabels[charge.kind]}: ${charge.description}`
      : own
        ? `${lineLabels[charge.kind]} ${own.label}`
        : lineLabels[charge.kind]
  return `${what}, ${periodLabel(period)}`
}

/**
 * What a recurring charge costs for `period`: month by month, part months per day, within both
 * the charge's dates and the agreement's (start to last billed day).
 */
export function recurringAmount(
  charge: Pick<Charge, 'amountOre' | 'interval' | 'fromDate' | 'toDate'>,
  agreement: { startDate: string; endDate: string | null },
  period: Period,
): number {
  if (charge.interval === 'once') return 0
  const start = maxDate(charge.fromDate, agreement.startDate)
  const ends = [charge.toDate, agreement.endDate].filter((d): d is string => d !== null)
  const end = ends.length > 0 ? ends.reduce((a, b) => minDate(a, b)) : null
  if (end !== null && end < start) return 0
  return rentForPeriod(
    { startDate: start, endDate: end, rentOre: charge.amountOre, rentInterval: charge.interval },
    period,
  )
}

export interface InvoiceLineDraft {
  chargeId: string
  kind: ChargeKind
  description: string
  netOre: number
  vatRatePercent: number
  vatOre: number
}

/**
 * The avi lines for `period`: each recurring charge that applies in it, and each one-off charge
 * dated up to the period's end that no avi in force has billed yet. Base charges come first.
 */
export function invoiceLines(
  charges: readonly Charge[],
  agreement: { startDate: string; endDate: string | null },
  units: readonly LineUnit[],
  period: Period,
  billedOnce: ReadonlySet<string>,
): InvoiceLineDraft[] {
  // Units with an add-on of their own in the period are billed on that line, not the base one.
  const ownLines = new Set(
    charges
      .filter(
        (c) =>
          c.unitId && !isBaseKind(c.kind) && c.interval !== 'once' && overlapsPeriod(c, period),
      )
      .map((c) => c.unitId),
  )
  const baseUnits = units.filter((u) => !u.unitId || !ownLines.has(u.unitId))
  const order = (c: Charge) => (isBaseKind(c.kind) ? 0 : c.interval === 'once' ? 2 : 1)
  return [...charges]
    .sort((a, b) => order(a) - order(b) || a.fromDate.localeCompare(b.fromDate))
    .flatMap((charge) => {
      const netOre =
        charge.interval === 'once'
          ? charge.fromDate <= period.end && !billedOnce.has(charge.id)
            ? charge.amountOre
            : 0
          : overlapsPeriod(charge, period)
            ? recurringAmount(charge, agreement, period)
            : 0
      if (netOre === 0) return []
      const vatOre = vatFor(netOre, charge.vat)
      return [
        {
          chargeId: charge.id,
          kind: charge.kind,
          description: lineDescription(charge, isBaseKind(charge.kind) ? baseUnits : units, period),
          netOre,
          vatRatePercent: charge.vat ? VAT_RATE_PERCENT : 0,
          vatOre,
        },
      ]
    })
}

export const totalsOf = (lines: readonly { netOre: number; vatOre: number }[]) => {
  const netOre = lines.reduce((sum, l) => sum + l.netOre, 0)
  const vatOre = lines.reduce((sum, l) => sum + l.vatOre, 0)
  return { netOre, vatOre, totalOre: netOre + vatOre }
}

export type ChangeProblem = 'too_early' | 'ended' | 'same_amount' | 'negative'

/**
 * Why a recurring charge can't change to `amountOre` from `fromDate`, or null. The old charge
 * ends the day before; a change on its own first day is a correction, not a change.
 */
export function changeProblem(
  current: Pick<Charge, 'fromDate' | 'toDate' | 'amountOre'>,
  fromDate: string,
  amountOre: number,
): ChangeProblem | null {
  if (amountOre < 0) return 'negative'
  if (fromDate <= current.fromDate) return 'too_early'
  if (current.toDate !== null && current.toDate < fromDate) return 'ended'
  if (amountOre === current.amountOre) return 'same_amount'
  return null
}

/**
 * The extra (or, if negative, reduced) amount for days from `fromDate` that avier in force have
 * already billed at the old amount. It goes on the next avi as a one-off line.
 */
export function retroactiveDifference(
  old: Pick<Charge, 'amountOre' | 'interval' | 'fromDate' | 'toDate'>,
  amountOre: number,
  fromDate: string,
  agreement: { startDate: string; endDate: string | null },
  invoicedPeriods: readonly Period[],
): number {
  const from = { fromDate, toDate: old.toDate }
  return invoicedPeriods.reduce((sum, period) => {
    if (period.end < fromDate) return sum
    const billed = recurringAmount({ ...old, ...from }, agreement, period)
    const due = recurringAmount({ ...old, ...from, amountOre }, agreement, period)
    return sum + due - billed
  }, 0)
}

/** "Retroaktiv justering av hyra 2026-01-01 – 2026-03-31" */
export const retroactiveDescription = (kind: ChargeKind, from: string, to: string) =>
  `Retroaktiv justering av ${lineLabels[kind].toLowerCase()} ${from} – ${to}`

export { dayBefore }
