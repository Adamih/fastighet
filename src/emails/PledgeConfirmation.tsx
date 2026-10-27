import { Column, Row, Section, Text } from '@react-email/components'
import { EmailHeading, EmailLayout, Paragraph } from './_components/EmailLayout'

// The förening's confirmation to a lender that its pledge was registered in the apartment
// register, or released. The text comes from `confirmationText` (features/pledges), so the email
// says exactly what the printable confirmation says.
export type Props = {
  subject: string
  title: string
  greeting: string
  paragraphs: string[]
  facts: [string, string][]
  signature: string[]
  sender: string[]
  /** Whether replies reach the förening (it has an email address). */
  canReply: boolean
}

export const subject = (props: Props) => props.subject

const cell = { fontSize: '14px', lineHeight: '22px', margin: 0 }
const muted = { ...cell, color: '#71717a' }

export default function PledgeConfirmation(props: Props) {
  return (
    <EmailLayout
      preview={props.paragraphs[0] ?? props.title}
      footer={
        props.canReply
          ? 'Skickat från Fastighet. Svar på meddelandet går till föreningen.'
          : undefined
      }
    >
      <EmailHeading>{props.title}</EmailHeading>
      <Paragraph>{props.greeting}</Paragraph>
      {props.paragraphs.map((p) => (
        <Paragraph key={p}>{p}</Paragraph>
      ))}

      <Section
        style={{
          backgroundColor: '#f4f4f5',
          borderRadius: '6px',
          padding: '16px',
          margin: '0 0 16px',
        }}
      >
        {props.facts.map(([label, value]) => (
          <Row key={label}>
            <Column style={{ width: '45%', verticalAlign: 'top' }}>
              <Text style={muted}>{label}</Text>
            </Column>
            <Column style={{ verticalAlign: 'top' }}>
              <Text style={cell}>{value}</Text>
            </Column>
          </Row>
        ))}
      </Section>

      {props.signature.map((line) => (
        <Text key={line} style={cell}>
          {line}
        </Text>
      ))}
      {props.sender.map((line) => (
        <Text key={line} style={muted}>
          {line}
        </Text>
      ))}
    </EmailLayout>
  )
}

PledgeConfirmation.PreviewProps = {
  subject: 'Pantsättning registrerad: bostadsrätt 3 i Brf Linden, er ref. BL-449120',
  title: 'Bekräftelse av pantsättning',
  greeting: 'Till Exempelbanken AB',
  paragraphs: [
    'Brf Linden bekräftar att underrättelsen om pantsättning av bostadsrätten nedan kom in till föreningen 2026-10-20 och har antecknats i lägenhetsförteckningen.',
    'Pantsättningen har plats 2 i företrädesordningen bland de pantsättningar som är registrerade på bostadsrätten. Ordningen följer den dag underrättelserna kom in.',
  ],
  facts: [
    ['Bostadsrättsförening', 'Brf Linden (769600-0003)'],
    ['Bostadsrätt', 'Nr 3'],
    ['Lägenhet', 'Lgh 1101, Uppsala Svartbäcken 3:12, Lindgatan 3, 75330 Uppsala'],
    ['Bostadsrättshavare', 'Anna Lund (50 %), Per Lund (50 %)'],
    ['Panthavare', 'Exempelbanken AB (502000-0005)'],
    ['Er referens', 'BL-449120'],
    ['Underrättelsen kom in', '2026-10-20'],
    ['Företrädesordning', '2'],
  ],
  signature: ['Brf Linden, styrelsen', '2026-10-27'],
  sender: ['Lindgatan 3, 75330 Uppsala', 'styrelsen@brflinden.test'],
  canReply: true,
} satisfies Props
