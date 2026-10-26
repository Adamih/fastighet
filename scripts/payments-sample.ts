// Writes a camt.054 file that pays the open invoices in the LOCAL database, for trying the
// payment import: `bun run payments:sample`, then upload the file under Betalningar.
//
// Every open invoice is paid in full except the second, which is paid 100 kr short. The file
// also has a payment with an OCR that matches no invoice and one with only free text.

import { writeFileSync } from 'node:fs'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import * as schema from '#/db/schema'
import { buildCamt054, type SamplePayment } from '#/features/payments/camt054-builder'
import { stockholmDate } from '#/lib/dates'
import { luhnCheckDigit } from '#/lib/luhn'

const OUTPUT = '.wrangler/sample-camt054.xml'

const { env, dispose } = await getPlatformProxy<Env>()
const db = drizzle(env.DB, { schema })

try {
  const settings = await db.query.organizationSettings.findFirst()
  if (!settings?.bankgiro) {
    console.error('No company with a bankgiro found. Run `bun run db:reset` first.')
    process.exitCode = 1
  } else {
    // Open avier: not voided, with something still owed in the ledger.
    const owed = await db
      .select({
        invoiceId: schema.ledgerEntry.invoiceId,
        owedOre: sql<number>`sum(${schema.ledgerEntry.amountOre})`,
      })
      .from(schema.ledgerEntry)
      .where(
        and(
          eq(schema.ledgerEntry.organizationId, settings.organizationId),
          eq(schema.ledgerEntry.account, 'receivable'),
        ),
      )
      .groupBy(schema.ledgerEntry.invoiceId)
    const owedBy = new Map(owed.map((o) => [o.invoiceId, o.owedOre]))
    const open = (
      await db.query.invoice.findMany({
        where: and(
          eq(schema.invoice.organizationId, settings.organizationId),
          isNull(schema.invoice.voidedAt),
        ),
        orderBy: asc(schema.invoice.number),
      })
    )
      .map((inv) => ({ ...inv, totalOre: owedBy.get(inv.id) ?? 0 }))
      .filter((inv) => inv.totalOre > 0)
    const today = stockholmDate(Date.now())
    const stamp = Date.now()
    const payments: SamplePayment[] = open.map((inv, i) => ({
      bookingDate: today,
      amountOre: i === 1 ? inv.totalOre - 10000 : inv.totalOre,
      ocr: inv.ocr,
      payerName: inv.recipientName,
      bankReference: `SAMPLE-${stamp}-${inv.number}`,
    }))
    const unknownOcr = `99999${luhnCheckDigit('99999')}`
    payments.push(
      {
        bookingDate: today,
        amountOre: 123400,
        ocr: unknownOcr,
        payerName: 'Okänd Betalare',
        bankReference: `SAMPLE-${stamp}-unknown`,
      },
      {
        bookingDate: today,
        amountOre: 500000,
        freeText: 'Deposition lägenhet 1102',
        payerName: 'Ny Hyresgäst',
        bankReference: `SAMPLE-${stamp}-deposit`,
      },
    )

    writeFileSync(
      OUTPUT,
      buildCamt054({ messageId: `SAMPLE-${stamp}`, bankgiro: settings.bankgiro, payments }),
    )
    console.log(
      `Wrote ${OUTPUT}: ${open.length} open invoices paid (the second one 100 kr short), plus 2 unknown payments.`,
    )
  }
} finally {
  await dispose()
}
