import { Column, Row, Section, Text } from '@react-email/components'
import { EmailHeading, EmailLayout, Paragraph, PortalLink } from './_components/EmailLayout'

// Amounts and dates arrive formatted (credited amounts as negative), so the template has no money
// or date logic.
export type Props = {
  recipientName: string
  organizationName: string
  creditNoteNumber: number
  /** What the credited invoice is called: "Hyresavi" or "Avgiftsavi". */
  invoiceName: string
  invoiceNumber: number
  invoiceIssueDate: string
  issueDate: string
  reason: string
  lines: { description: string; amount: string }[]
  net: string
  /** Null when no VAT is credited. */
  vat: string | null
  total: string
  /** Whether the credited invoice was already paid, so the amount becomes credit (tillgodo). */
  toCredit: boolean
  /** Seller details for the footer: address, organisationsnummer, VAT number, F-skatt. */
  sellerDetails: string[]
  /** The avi in Mina sidor, when the recipient has access there. */
  portalUrl?: string | null
}

export const subject = (props: Props) =>
  `Kreditfaktura ${props.creditNoteNumber} från ${props.organizationName}`

const cell = { fontSize: '14px', lineHeight: '22px', margin: 0 }
const muted = { ...cell, color: '#71717a' }

function AmountRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Row>
      <Column>
        <Text style={{ ...cell, fontWeight: strong ? 600 : 400 }}>{label}</Text>
      </Column>
      <Column align="right">
        <Text style={{ ...cell, fontWeight: strong ? 600 : 400 }}>{value}</Text>
      </Column>
    </Row>
  )
}

export default function CreditNote(props: Props) {
  return (
    <EmailLayout
      preview={`Kreditering av avi ${props.invoiceNumber}: ${props.total}. ${props.reason}`}
    >
      <EmailHeading>Kreditfaktura {props.creditNoteNumber}</EmailHeading>
      <Paragraph>Hej {props.recipientName}!</Paragraph>
      <Paragraph>
        {props.organizationName} har krediterat din {props.invoiceName.toLowerCase()}{' '}
        {props.invoiceNumber} ({props.invoiceIssueDate}).{' '}
        {props.toCredit
          ? 'Avin var redan betald, så beloppet står till godo hos oss. Det dras av på din nästa avi, eller betalas tillbaka om du ber om det.'
          : 'Beloppet dras av från det du ska betala på avin.'}
      </Paragraph>

      <Section
        style={{
          backgroundColor: '#f4f4f5',
          borderRadius: '6px',
          padding: '16px',
          margin: '0 0 16px',
        }}
      >
        <AmountRow label="Krediterat belopp" value={props.total} strong />
        <AmountRow label="Avser avi" value={String(props.invoiceNumber)} />
        <AmountRow label="Datum" value={props.issueDate} />
      </Section>

      <Paragraph>Orsak: {props.reason}</Paragraph>

      <Section style={{ margin: '0 0 16px' }}>
        {props.lines.map((line) => (
          <AmountRow key={line.description} label={line.description} value={line.amount} />
        ))}
        {props.vat && (
          <>
            <AmountRow label="Summa exkl. moms" value={props.net} />
            <AmountRow label="Moms" value={props.vat} />
          </>
        )}
        <AmountRow label="Totalt" value={props.total} strong />
      </Section>

      {props.portalUrl && <PortalLink href={props.portalUrl} />}
      <Text style={muted}>Kreditfaktura {props.creditNoteNumber}</Text>
      {props.sellerDetails.map((line) => (
        <Text key={line} style={muted}>
          {line}
        </Text>
      ))}
    </EmailLayout>
  )
}

CreditNote.PreviewProps = {
  recipientName: 'Anna Svensson',
  organizationName: 'Exempel Fastigheter AB',
  creditNoteNumber: 3,
  invoiceName: 'Hyresavi',
  invoiceNumber: 1042,
  invoiceIssueDate: '2026-09-11',
  issueDate: '2026-10-25',
  reason: 'Hyresreduktion för vattenskada i köket',
  lines: [{ description: 'Kreditering, avi 1042', amount: '−2 000,00 kr' }],
  net: '−2 000,00 kr',
  vat: null,
  total: '−2 000,00 kr',
  toCredit: false,
  sellerDetails: [
    'Exempel Fastigheter AB, Storgatan 1, 753 20 Uppsala',
    'Org.nr 556677-8899 · Godkänd för F-skatt',
  ],
} satisfies Props
