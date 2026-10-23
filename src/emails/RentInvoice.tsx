import { Column, Row, Section, Text } from '@react-email/components'
import { EmailHeading, EmailLayout, Paragraph } from './_components/EmailLayout'

// Amounts and dates arrive formatted, so the template has no money or date logic.
export type Props = {
  recipientName: string
  organizationName: string
  invoiceNumber: number
  periodLabel: string
  lines: { description: string; amount: string }[]
  net: string
  /** Null when the rent carries no VAT. */
  vat: string | null
  total: string
  dueDate: string
  bankgiro: string
  ocr: string
  /** Seller details for the footer: address, organisationsnummer, VAT number, F-skatt. */
  sellerDetails: string[]
}

export const subject = (props: Props) =>
  `Hyresavi ${props.periodLabel} från ${props.organizationName}`

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

export default function RentInvoice(props: Props) {
  return (
    <EmailLayout preview={`Att betala ${props.total} senast ${props.dueDate}. OCR ${props.ocr}.`}>
      <EmailHeading>Hyresavi {props.periodLabel}</EmailHeading>
      <Paragraph>Hej {props.recipientName}!</Paragraph>
      <Paragraph>
        Här är din hyresavi från {props.organizationName}. Betala till bankgiro och ange OCR-numret,
        så registreras betalningen automatiskt.
      </Paragraph>

      <Section
        style={{
          backgroundColor: '#f4f4f5',
          borderRadius: '6px',
          padding: '16px',
          margin: '0 0 16px',
        }}
      >
        <AmountRow label="Att betala" value={props.total} strong />
        <AmountRow label="Förfallodag" value={props.dueDate} />
        <AmountRow label="Bankgiro" value={props.bankgiro} />
        <AmountRow label="OCR-nummer" value={props.ocr} />
      </Section>

      <Section style={{ margin: '0 0 16px' }}>
        {props.lines.map((line) => (
          <AmountRow key={line.description} label={line.description} value={line.amount} />
        ))}
        {props.vat && (
          <>
            <AmountRow label="Summa exkl. moms" value={props.net} />
            <AmountRow label="Moms 25 %" value={props.vat} />
          </>
        )}
        <AmountRow label="Totalt" value={props.total} strong />
      </Section>

      <Text style={muted}>Fakturanummer {props.invoiceNumber}</Text>
      {props.sellerDetails.map((line) => (
        <Text key={line} style={muted}>
          {line}
        </Text>
      ))}
    </EmailLayout>
  )
}

RentInvoice.PreviewProps = {
  recipientName: 'Kaffe AB',
  organizationName: 'Exempel Fastigheter AB',
  invoiceNumber: 1042,
  periodLabel: 'januari–mars 2027',
  lines: [
    {
      description: 'Hyra Uppsala Kungsängen 12:3 · 2001, januari–mars 2027',
      amount: '30 000,00 kr',
    },
  ],
  net: '30 000,00 kr',
  vat: '7 500,00 kr',
  total: '37 500,00 kr',
  dueDate: '2026-12-31',
  bankgiro: '5050-1055',
  ocr: '10424',
  sellerDetails: [
    'Exempel Fastigheter AB, Storgatan 1, 753 20 Uppsala',
    'Org.nr 556677-8899 · Momsreg.nr SE556677889901 · Godkänd för F-skatt',
  ],
} satisfies Props
