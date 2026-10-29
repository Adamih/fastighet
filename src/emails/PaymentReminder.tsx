import { Column, Row, Section, Text } from '@react-email/components'
import { EmailHeading, EmailLayout, Paragraph } from './_components/EmailLayout'

// Amounts and dates arrive formatted, so the template has no money or date logic.
export type Props = {
  recipientName: string
  organizationName: string
  /** "Hyresavi" or "Avgiftsavi". */
  documentName: string
  invoiceNumber: number
  periodLabel: string
  /** The avi's original due date. */
  originalDueDate: string
  /** 1 for the first reminder, 2 for the second, … */
  sequence: number
  /** What is still owed on the avi. */
  total: string
  /** The reminder fee, billed on the next avi; null when none is charged. */
  fee: string | null
  dueDate: string
  bankgiro: string
  ocr: string
  sellerDetails: string[]
}

export const subject = (props: Props) =>
  `${props.sequence > 1 ? `Påminnelse ${props.sequence}` : 'Påminnelse'}: ${props.documentName.toLowerCase()} ${props.invoiceNumber} från ${props.organizationName}`

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

export default function PaymentReminder(props: Props) {
  return (
    <EmailLayout preview={`Att betala ${props.total} senast ${props.dueDate}. OCR ${props.ocr}.`}>
      <EmailHeading>
        {props.sequence > 1 ? `Påminnelse ${props.sequence}` : 'Påminnelse'}
      </EmailHeading>
      <Paragraph>Hej {props.recipientName}!</Paragraph>
      <Paragraph>
        Vi har inte fått betalt för din {props.documentName.toLowerCase()} {props.invoiceNumber} (
        {props.periodLabel}), som förföll {props.originalDueDate}. Betala till bankgiro med samma
        OCR-nummer senast {props.dueDate}. Har du redan betalat kan du bortse från den här
        påminnelsen.
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
        <AmountRow label="Betala senast" value={props.dueDate} />
        <AmountRow label="Bankgiro" value={props.bankgiro} />
        <AmountRow label="OCR-nummer" value={props.ocr} />
      </Section>

      {props.fee && (
        <Paragraph>
          En påminnelseavgift på {props.fee} läggs på din nästa {props.documentName.toLowerCase()}.
        </Paragraph>
      )}

      <Text style={muted}>
        {props.documentName} {props.invoiceNumber}
      </Text>
      {props.sellerDetails.map((line) => (
        <Text key={line} style={muted}>
          {line}
        </Text>
      ))}
    </EmailLayout>
  )
}

PaymentReminder.PreviewProps = {
  recipientName: 'Anna Svensson',
  organizationName: 'Exempel Fastigheter AB',
  documentName: 'Hyresavi',
  invoiceNumber: 1042,
  periodLabel: 'oktober 2026',
  originalDueDate: '2026-09-30',
  sequence: 1,
  total: '8 510,00 kr',
  fee: '60,00 kr',
  dueDate: '2026-10-26',
  bankgiro: '990-0002',
  ocr: '10421',
  sellerDetails: ['Exempel Fastigheter AB, Exempelgatan 1, 753 20 Uppsala', 'Org.nr 559900-0006'],
} satisfies Props
