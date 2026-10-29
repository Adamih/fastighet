import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import type { Db } from '#/db'
import { charge, invoice, lateInterest, referenceRate } from '#/db/schema'
import type { ReceivableEntry } from '#/features/ledger/postings'
import { receivableEntriesFor } from '#/features/ledger/program'
import { loadCompanyDetails } from '#/features/settings/program'
import { orgQuery, query } from '#/server/scoped'
import { today } from '#/server/today'
import { lateInterest as interestFor } from './rules'

// Charging dröjsmålsränta. Payment programs call `lateInterestStatements` with the entries they
// are about to write, as they do for reminder fee waivers: when a payment settles an avi after
// its due date, the interest becomes a one-off charge on the avi's agreement, dated today, so
// the next avi bills it (the late avi itself stays paid). Nothing here checks permissions; the
// calling program has.

/** D1 allows 100 bound values per statement; `IN (...)` lists stay well below that. */
const IN_CHUNK = 50

/** Every known reference rate, oldest first. */
export const referenceRates = query((db) =>
  db.select().from(referenceRate).orderBy(referenceRate.fromDate),
)

/**
 * For payments about to settle avier (`planned`: the receivable entries they will write, per
 * avi), the statements that charge interest on the ones paid late, per avi, to write in the
 * same batch as the payment. Only when the company charges interest; once per avi; never on an
 * agreement that has ended, which has no next avi; never below the company's minimum.
 */
export const lateInterestStatements = (planned: ReadonlyMap<string, readonly ReceivableEntry[]>) =>
  Effect.gen(function* () {
    const builders = new Map<
      string,
      (db: Db, organizationId: string) => ReturnType<typeof chargeStatements>
    >()
    const settings = yield* loadCompanyDetails
    if (!settings.lateInterest || planned.size === 0) return builders
    const on = yield* today
    const ids = [...planned.keys()]
    const avier: {
      id: string
      number: number
      dueDate: string
      agreementId: string
      agreementEnds: string | null
      charged: string | null
    }[] = []
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const batch = ids.slice(i, i + IN_CHUNK)
      avier.push(
        ...(yield* orgQuery((db, organizationId) =>
          db.query.invoice.findMany({
            columns: { id: true, number: true, dueDate: true, agreementId: true },
            where: and(
              eq(invoice.organizationId, organizationId),
              inArray(invoice.id, batch),
              isNull(invoice.voidedAt),
            ),
            with: {
              agreement: { columns: { endDate: true } },
              lateInterest: { columns: { id: true } },
            },
          }),
        )).map(({ agreement, lateInterest: charged, ...row }) => ({
          ...row,
          agreementEnds: agreement.endDate,
          charged: charged?.id ?? null,
        })),
      )
    }
    const due = avier.filter(
      (a) => !a.charged && a.dueDate < on && (a.agreementEnds === null || a.agreementEnds >= on),
    )
    if (due.length === 0) return builders
    const rates = yield* referenceRates
    const existing = yield* receivableEntriesFor(due.map((a) => a.id))
    const minimumOre = Math.max(100, settings.lateInterestMinimumOre ?? 0)
    for (const avi of due) {
      const entries = [...(existing.get(avi.id) ?? []), ...(planned.get(avi.id) ?? [])]
      const interest = interestFor(entries, avi.dueDate, rates)
      if (!interest) continue
      if ('missingRateFor' in interest) {
        // A payment never fails for this; the interest just isn't charged.
        yield* Effect.logWarning(
          `No reference rate for ${interest.missingRateFor}; no late interest on avi ${avi.number}. Add it in a migration.`,
        )
        continue
      }
      if (interest.ore < minimumOre) continue
      builders.set(avi.id, (db, organizationId) =>
        chargeStatements(db, organizationId, avi, interest, on),
      )
    }
    return builders
  })

function chargeStatements(
  db: Db,
  organizationId: string,
  avi: { id: string; number: number; agreementId: string },
  interest: { ore: number; fromDate: string; toDate: string; days: number },
  on: string,
) {
  const chargeId = crypto.randomUUID()
  return [
    db.insert(charge).values({
      id: chargeId,
      organizationId,
      agreementId: avi.agreementId,
      kind: 'late_interest',
      description: `Dröjsmålsränta avi ${avi.number}, ${interest.days} ${interest.days === 1 ? 'dag' : 'dagar'}`,
      amountOre: interest.ore,
      interval: 'once',
      // Interest is compensation for late payment, not a sale: no VAT.
      vat: false,
      fromDate: on,
    }),
    db.insert(lateInterest).values({
      organizationId,
      invoiceId: avi.id,
      chargeId,
      fromDate: interest.fromDate,
      toDate: interest.toDate,
      days: interest.days,
      amountOre: interest.ore,
    }),
  ]
}
