import { Effect } from 'effect'
import { manualPaymentEntries } from '#/features/ledger/postings'
import { livePostings, postingStatements, reversalStatements } from '#/features/ledger/program'
import { settlementStatements } from '#/features/ledger/settlement'
import { undoPaymentStatements } from '#/features/payments/program'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { orgQuery } from '#/server/scoped'
import { today } from '#/server/today'
import { getInvoice } from './program'
import type { MarkPaidInput } from './schemas'

// Payments by hand on an avi, and "Ångra betalning". Bank payments are in `features/payments`.

const manage: Permissions = { invoice: ['manage'] }

export const markInvoicePaid = Effect.fn('invoicing.markInvoicePaid')(function* (
  input: MarkPaidInput,
) {
  yield* requirePermission(manage)
  const inv = yield* getInvoice(input.invoiceId)
  if (inv.status === 'void') return yield* new Conflict({ message: 'Avin är makulerad' })
  if (inv.status === 'paid') return yield* new Conflict({ message: 'Avin är redan betald' })
  if (inv.status === 'credited') return yield* new Conflict({ message: 'Avin är krediterad' })
  if (input.paidOn > (yield* today)) {
    return yield* new Conflict({ message: 'Betaldatum kan inte vara i framtiden' })
  }
  // A payment by hand settles what is still owed, straight from the bank, with what settling
  // the avi brings along (fee waivers, late interest).
  const settled = (yield* settlementStatements(
    new Map([[inv.id, [{ kind: 'manual_payment', date: input.paidOn, amountOre: -inv.owedOre }]]]),
  )).get(inv.id)
  yield* orgQuery((db, organizationId) =>
    db.batch([
      ...postingStatements(
        db,
        organizationId,
        {
          date: input.paidOn,
          kind: 'manual_payment',
          description: `Betalning av avi ${inv.number}`,
          invoiceId: inv.id,
        },
        manualPaymentEntries(inv.id, inv.owedOre),
        { partyId: inv.partyId, agreementId: inv.agreementId },
      ),
      ...(settled ? settled(db, organizationId) : []),
    ]),
  )
  return yield* getInvoice(inv.id)
})

/**
 * "Ångra betalning": reverses every payment on the avi. A bank payment is undone as a whole, on
 * every avi it was split over, and goes back to needing attention; payments by hand are
 * reversed. Credit used on the avi stays.
 */
export const unmarkInvoicePaid = Effect.fn('invoicing.unmarkInvoicePaid')(function* (
  invoiceId: string,
) {
  yield* requirePermission({ invoice: ['manage'], payment: ['manage'] })
  const inv = yield* getInvoice(invoiceId)
  if (inv.paidOre <= 0) return yield* new Conflict({ message: 'Avin har inga betalningar' })
  const live = yield* livePostings({ kinds: ['allocation', 'manual_payment'], invoiceId: inv.id })
  const byHand = live.filter((l) => l.posting.kind === 'manual_payment')
  const paymentIds = [
    ...new Set(live.flatMap((l) => (l.posting.paymentId ? [l.posting.paymentId] : []))),
  ]
  const on = yield* today
  const bank = paymentIds.length > 0 ? yield* undoPaymentStatements(paymentIds, on) : null
  yield* orgQuery((db, organizationId) => {
    const [first, ...rest] = [
      ...reversalStatements(
        db,
        organizationId,
        byHand,
        on,
        () => `Ångrad betalning av avi ${inv.number}`,
      ),
      ...(bank ? bank(db, organizationId) : []),
    ]
    return db.batch([first, ...rest])
  })
  return yield* getInvoice(inv.id)
})
