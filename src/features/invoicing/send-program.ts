import { eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { creditNote, invoice } from '#/db/schema'
import { sellerDetails } from '#/features/settings/seller'
import { documentTerms } from '#/features/settings/terminology'
import { formatSek } from '#/lib/money'
import type { Permissions } from '#/lib/permissions'
import { requirePermission } from '#/server/authorize'
import { Conflict } from '#/server/errors'
import { sendEmail } from '#/server/mail/mailer'
import { inCompany, orgQuery } from '#/server/scoped'
import { getCreditNote } from './credit-program'
import { getInvoice } from './program'
import { periodLabel } from './rules'

// Sending avier and credit notes by email, recording when each was sent.

const manage: Permissions = { invoice: ['manage'] }

/**
 * Emails one invoice to its recipient and records when it was sent. Returns false when the
 * tenant has no email address and `skipWithoutEmail` is set.
 */
export const emailInvoice = Effect.fn('invoicing.emailInvoice')(function* (
  invoiceId: string,
  options: { skipWithoutEmail?: boolean } = {},
) {
  yield* requirePermission(manage)
  const inv = yield* getInvoice(invoiceId)
  if (inv.status === 'void') {
    return yield* new Conflict({ message: 'En makulerad avi kan inte skickas' })
  }
  if (inv.status === 'credited') {
    return yield* new Conflict({ message: 'En krediterad avi kan inte skickas' })
  }
  if (!inv.recipientEmail) {
    if (options.skipWithoutEmail) return false
    return yield* new Conflict({ message: 'Hyresgästen har ingen e-postadress' })
  }
  if (!inv.seller.bankgiro) {
    return yield* new Conflict({ message: 'Ange bankgironummer under Företagsuppgifter först' })
  }

  yield* sendEmail({
    to: inv.recipientEmail,
    template: 'rentInvoice',
    props: {
      documentName: documentTerms(inv.agreement.kind).invoiceTitle,
      recipientName: inv.recipientName,
      organizationName: inv.seller.organizationName,
      invoiceNumber: inv.number,
      periodLabel: periodLabel({ start: inv.periodStart, end: inv.periodEnd }),
      lines: inv.lines.map((l) => ({ description: l.description, amount: formatSek(l.netOre) })),
      net: formatSek(inv.netOre),
      vat: inv.vatOre > 0 ? formatSek(inv.vatOre) : null,
      total: formatSek(inv.totalOre),
      creditUsed: inv.creditUsedOre > 0 ? formatSek(-inv.creditUsedOre) : null,
      toPay: formatSek(inv.totalOre - inv.creditUsedOre),
      dueDate: inv.dueDate,
      bankgiro: inv.seller.bankgiro,
      ocr: inv.ocr,
      sellerDetails: sellerDetails(inv.seller, inv.vatOre > 0),
    },
  })

  const sentAt = new Date(yield* Clock.currentTimeMillis)
  yield* orgQuery((db, organizationId) =>
    db
      .update(invoice)
      .set({ sentAt })
      .where(inCompany(invoice, organizationId, eq(invoice.id, inv.id))),
  )
  return true
})

/** Emails a credit note to the recipient of the invoice it credits and records when. */
export const emailCreditNote = Effect.fn('invoicing.emailCreditNote')(function* (
  creditNoteId: string,
) {
  yield* requirePermission(manage)
  const note = yield* getCreditNote(creditNoteId)
  if (!note.recipientEmail) {
    return yield* new Conflict({ message: 'Hyresgästen har ingen e-postadress' })
  }
  const negative = (ore: number) => formatSek(-ore)
  yield* sendEmail({
    to: note.recipientEmail,
    template: 'creditNote',
    props: {
      recipientName: note.recipientName,
      organizationName: note.seller.organizationName,
      creditNoteNumber: note.number,
      invoiceName: documentTerms(note.invoice.agreement.kind).invoiceTitle,
      invoiceNumber: note.invoice.number,
      invoiceIssueDate: note.invoice.issueDate,
      issueDate: note.issueDate,
      reason: note.reason,
      lines: note.lines.map((l) => ({ description: l.description, amount: negative(l.netOre) })),
      net: negative(note.netOre),
      vat: note.vatOre > 0 ? negative(note.vatOre) : null,
      total: negative(note.totalOre),
      toCredit: note.toCredit,
      sellerDetails: sellerDetails(note.seller, note.vatOre > 0),
    },
  })
  const sentAt = new Date(yield* Clock.currentTimeMillis)
  yield* orgQuery((db, organizationId) =>
    db
      .update(creditNote)
      .set({ sentAt })
      .where(inCompany(creditNote, organizationId, eq(creditNote.id, note.id))),
  )
  return true
})
