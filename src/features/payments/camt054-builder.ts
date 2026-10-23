// Writes camt.054 files for tests and the `payments:sample` script. Not used by the app itself.

export interface SamplePayment {
  bookingDate: string
  /** Amount in öre. */
  amountOre: number
  ocr?: string
  freeText?: string
  payerName?: string
  bankReference: string
  debit?: boolean
  currency?: string
}

const xmlEscape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
const amount = (ore: number) => (ore / 100).toFixed(2)

function transaction(p: SamplePayment): string {
  const remittance = p.ocr
    ? `<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${xmlEscape(p.ocr)}</Ref></CdtrRefInf></Strd></RmtInf>`
    : p.freeText
      ? `<RmtInf><Ustrd>${xmlEscape(p.freeText)}</Ustrd></RmtInf>`
      : ''
  return `
        <TxDtls>
          <Refs><AcctSvcrRef>${xmlEscape(p.bankReference)}</AcctSvcrRef></Refs>
          <Amt Ccy="${p.currency ?? 'SEK'}">${amount(p.amountOre)}</Amt>
          <CdtDbtInd>${p.debit ? 'DBIT' : 'CRDT'}</CdtDbtInd>
          ${p.payerName ? `<RltdPties><Dbtr><Nm>${xmlEscape(p.payerName)}</Nm></Dbtr></RltdPties>` : ''}
          ${remittance}
        </TxDtls>`
}

/** One entry per booking date, each a batch booking of that day's payments. */
export function buildCamt054(options: {
  messageId: string
  bankgiro: string
  payments: SamplePayment[]
}): string {
  const byDate = new Map<string, SamplePayment[]>()
  for (const p of options.payments)
    byDate.set(p.bookingDate, [...(byDate.get(p.bookingDate) ?? []), p])
  const entries = [...byDate.entries()]
    .map(([date, payments], i) => {
      const total = payments.reduce((sum, p) => sum + (p.debit ? 0 : p.amountOre), 0)
      return `
      <Ntry>
        <NtryRef>${i + 1}</NtryRef>
        <Amt Ccy="SEK">${amount(total)}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>${date}</Dt></BookgDt>
        <ValDt><Dt>${date}</Dt></ValDt>
        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>DMCT</SubFmlyCd></Fmly></Domn></BkTxCd>
        <NtryDtls><Btch><NbOfTxs>${payments.length}</NbOfTxs></Btch>${payments.map(transaction).join('')}
        </NtryDtls>
      </Ntry>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr>
      <MsgId>${xmlEscape(options.messageId)}</MsgId>
      <CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm>
    </GrpHdr>
    <Ntfctn>
      <Id>${xmlEscape(options.messageId)}-1</Id>
      <Acct><Id><Othr><Id>${xmlEscape(options.bankgiro.replace('-', ''))}</Id><SchmeNm><Prtry>BGNR</Prtry></SchmeNm></Othr></Id></Acct>${entries}
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>
`
}
