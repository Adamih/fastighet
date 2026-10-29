import { eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { creditNote, creditNoteLine, invoice } from '#/db/schema'
import { creditNoteEntries, creditTransferEntries } from '#/features/ledger/postings'
import { invoiceMoneyFor, postingStatements } from '#/features/ledger/program'
import { loadCompanyDetails } from '#/features/settings/program'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { inCompany, orgQuery, orNotFound } from '#/server/scoped'
import { today } from '#/server/today'
import { type CreditProblem, draftCreditNote } from './credit'
import { getInvoice } from './program'
import type { CreateCreditNoteInput } from './schemas'

// Credit notes (kreditfakturor): issuing one against an avi, and reading it.

const read: Permissions = { invoice: ['read'] }
const manage: Permissions = { invoice: ['manage'] }

const creditProblemMessages: Record<CreditProblem, string> = {
  void: 'En makulerad avi kan inte krediteras',
  nothing_left: 'Avin är redan krediterad i sin helhet',
  not_positive: 'Ange ett belopp större än noll',
  too_much: 'Beloppet är större än det som återstår att kreditera',
}

/**
 * Issues a credit note against an invoice: the next number in the company's credit note series,
 * the invoice's recipient details, and the credited amount added to the invoice, all in one
 * batch. Two credit notes created at once get the same number and the second batch fails on the
 * unique index, so a credit is always computed from the invoice as it is.
 */
export const createCreditNote = Effect.fn('invoicing.createCreditNote')(function* (
  input: CreateCreditNoteInput,
) {
  yield* requirePermission(manage)
  const inv = yield* getInvoice(input.invoiceId)
  const result = draftCreditNote(
    inv,
    input.kind === 'rest' ? { kind: 'rest' } : { kind: 'amount', netOre: input.netOre ?? 0 },
  )
  if (!result.ok) return yield* new Conflict({ message: creditProblemMessages[result.problem] })
  const { draft } = result

  const issueDate = yield* today
  const [{ maxNumber }] = yield* orgQuery((db, organizationId) =>
    db
      .select({ maxNumber: sql<number>`coalesce(max(${creditNote.number}), 0)` })
      .from(creditNote)
      .where(inCompany(creditNote, organizationId)),
  )
  const id = crypto.randomUUID()
  // A credit beyond what is still owed (the avi was paid, or paid with credit) becomes the
  // party's credit balance, to be used on the next avi or paid back.
  const toCreditOre = Math.max(0, draft.totalOre - Math.max(0, inv.owedOre))
  const owner = { partyId: inv.partyId, agreementId: inv.agreementId }
  yield* orgQuery((db, organizationId) =>
    db.batch([
      db.insert(creditNote).values({
        id,
        organizationId,
        number: maxNumber + 1,
        invoiceId: inv.id,
        reason: input.reason.trim(),
        recipientName: inv.recipientName,
        recipientStreetAddress: inv.recipientStreetAddress,
        recipientPostalCode: inv.recipientPostalCode,
        recipientCity: inv.recipientCity,
        recipientEmail: inv.recipientEmail,
        issueDate,
        netOre: draft.netOre,
        vatOre: draft.vatOre,
        totalOre: draft.totalOre,
      }),
      db.insert(creditNoteLine).values(
        draft.lines.map((line, index) => ({
          creditNoteId: id,
          organizationId,
          position: index + 1,
          ...line,
        })),
      ),
      db
        .update(invoice)
        .set({ creditedOre: sql`${invoice.creditedOre} + ${draft.totalOre}` })
        .where(inCompany(invoice, organizationId, eq(invoice.id, inv.id))),
      ...postingStatements(
        db,
        organizationId,
        {
          date: issueDate,
          kind: 'credit_note',
          description: `Kreditfaktura ${maxNumber + 1}`,
          invoiceId: inv.id,
          creditNoteId: id,
        },
        creditNoteEntries(inv.id, draft),
        owner,
      ),
      ...(toCreditOre > 0
        ? postingStatements(
            db,
            organizationId,
            {
              date: issueDate,
              kind: 'credit_transfer',
              description: `Kreditfaktura ${maxNumber + 1} till tillgodo`,
              invoiceId: inv.id,
              creditNoteId: id,
            },
            creditTransferEntries(inv.id, toCreditOre),
            owner,
          )
        : []),
    ]),
  )
  return { id }
})

export const getCreditNote = Effect.fn('invoicing.getCreditNote')(function* (creditNoteId: string) {
  yield* requirePermission(read)
  const row = yield* orgQuery((db, organizationId) =>
    db.query.creditNote.findFirst({
      where: inCompany(creditNote, organizationId, eq(creditNote.id, creditNoteId)),
      with: {
        lines: { orderBy: creditNoteLine.position },
        invoice: {
          columns: {
            id: true,
            number: true,
            issueDate: true,
            periodStart: true,
            periodEnd: true,
          },
          with: { agreement: { columns: { kind: true } } },
        },
      },
    }),
  ).pipe(orNotFound('creditNote', creditNoteId))
  const money = (yield* invoiceMoneyFor([row.invoice.id]))(row.invoice.id)
  return {
    ...row,
    /** Whether the credit went (in part) to the party's credit balance: the avi had been paid. */
    toCredit: money.toCreditOre > 0,
    invoiceMoney: money,
    seller: yield* loadCompanyDetails,
  }
})

export type CreditNoteView = Effect.Success<ReturnType<typeof getCreditNote>>
