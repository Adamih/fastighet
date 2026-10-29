import { eq, inArray, max, sum } from 'drizzle-orm'
import { Effect } from 'effect'
import { agreement, agreementParty, ledgerEntry, posting } from '#/db/schema'
import { inCompany, inParties, portalQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { agreementVisible } from './window'

// What a person sees in Mina sidor: the agreements their parties are or were on in the company
// in focus, every party seeing all of an agreement, as long as the access window allows
// (`window.ts`). Avier, payments and terms are read through these agreements.

/** The ids of the agreements that show for the person, in the company in focus. */
export const visibleAgreementIds = Effect.gen(function* () {
  const on = yield* today
  const agreements = yield* portalQuery((db, scope) =>
    db
      .selectDistinct({ id: agreement.id, endDate: agreement.endDate })
      .from(agreementParty)
      .innerJoin(agreement, eq(agreement.id, agreementParty.agreementId))
      .where(inParties(agreementParty, scope)),
  )
  if (agreements.length === 0) return [] as string[]
  // Money on each: what its receivable entries add up to, and when it last moved.
  const money = yield* portalQuery((db, scope) =>
    db
      .select({
        agreementId: ledgerEntry.agreementId,
        balanceOre: sum(ledgerEntry.amountOre).mapWith(Number),
        lastOn: max(posting.date),
      })
      .from(ledgerEntry)
      .innerJoin(posting, eq(posting.id, ledgerEntry.postingId))
      .where(
        inCompany(
          ledgerEntry,
          scope.organizationId,
          eq(ledgerEntry.account, 'receivable'),
          inArray(
            ledgerEntry.agreementId,
            agreements.map((a) => a.id),
          ),
        ),
      )
      .groupBy(ledgerEntry.agreementId),
  )
  const byAgreement = new Map(money.map((m) => [m.agreementId, m]))
  return agreements
    .filter((a) => {
      const m = byAgreement.get(a.id)
      return agreementVisible(
        {
          endDate: a.endDate,
          moneyOpen: (m?.balanceOre ?? 0) !== 0,
          lastMoneyOn: m?.lastOn ?? null,
        },
        on,
      )
    })
    .map((a) => a.id)
}).pipe(Effect.withSpan('portal.visibleAgreementIds'))
