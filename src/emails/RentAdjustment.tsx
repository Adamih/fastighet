import { Column, Row, Section, Text } from '@react-email/components'
import { EmailHeading, EmailLayout, Paragraph } from './_components/EmailLayout'

// The notice of a lease's new rent after the yearly indexation (indexuppräkning). Amounts, KPI
// values and dates arrive formatted, so the template has no money or date logic.
export type Props = {
  recipientName: string
  organizationName: string
  /** "avtal 12" */
  leaseLabel: string
  /** The day the new rent applies from. */
  effectiveDate: string
  /** Per year, e.g. "180 000,00 kr". */
  baseRent: string
  previousSupplement: string
  newSupplement: string
  newRent: string
  /** "exkl. moms" when the lease carries VAT, else null. */
  vatNote: string | null
  /** e.g. "100 %" */
  share: string
  /** "419,35 (oktober 2025)" */
  kpi: string
  /** "409,07 (oktober 2023)" */
  baseKpi: string
  /** What the next avi adds (or deducts) for days already billed at the old rent, or null. */
  retroactive: string | null
  sellerDetails: string[]
}

export const subject = (props: Props) =>
  `Ny hyra från ${props.effectiveDate}: ${props.leaseLabel} hos ${props.organizationName}`

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

export default function RentAdjustment(props: Props) {
  const perYear = props.vatNote ? `per år ${props.vatNote}` : 'per år'
  return (
    <EmailLayout preview={`Din hyra blir ${props.newRent} ${perYear} från ${props.effectiveDate}.`}>
      <EmailHeading>Ny hyra från {props.effectiveDate}</EmailHeading>
      <Paragraph>Hej {props.recipientName}!</Paragraph>
      <Paragraph>
        Enligt indexklausulen i ert hyresavtal ({props.leaseLabel}) räknas hyran om varje år efter
        konsumentprisindex (KPI). Bashyran är oförändrad; indextillägget ändras från{' '}
        {props.effectiveDate}.
      </Paragraph>

      <Section
        style={{
          backgroundColor: '#f4f4f5',
          borderRadius: '6px',
          padding: '16px',
          margin: '0 0 16px',
        }}
      >
        <AmountRow label="Bashyra" value={props.baseRent} />
        <AmountRow label="Indextillägg hittills" value={props.previousSupplement} />
        <AmountRow label="Nytt indextillägg" value={props.newSupplement} />
        <AmountRow label={`Ny hyra ${perYear}`} value={props.newRent} strong />
      </Section>

      <Paragraph>
        Indextillägget är {props.share} av bashyran gånger KPI:s ökning sedan basmånaden: KPI{' '}
        {props.kpi} mot {props.baseKpi} (1980=100), avrundat till hela kronor.
      </Paragraph>
      {props.retroactive && (
        <Paragraph>
          En avi för tiden efter {props.effectiveDate} har redan skickats med den tidigare hyran.
          Skillnaden, {props.retroactive}, kommer med på nästa avi.
        </Paragraph>
      )}
      <Paragraph>
        Den nya hyran kommer med på dina avier från och med {props.effectiveDate}.
      </Paragraph>

      {props.sellerDetails.map((line) => (
        <Text key={line} style={muted}>
          {line}
        </Text>
      ))}
    </EmailLayout>
  )
}

RentAdjustment.PreviewProps = {
  recipientName: 'Kaffe & Kaka AB',
  organizationName: 'Exempel Fastigheter AB',
  leaseLabel: 'avtal 4',
  effectiveDate: '2027-01-01',
  baseRent: '180 000,00 kr',
  previousSupplement: '4 523,00 kr',
  newSupplement: '6 570,00 kr',
  newRent: '186 570,00 kr',
  vatNote: 'exkl. moms',
  share: '100 %',
  kpi: '424,00 (oktober 2026)',
  baseKpi: '409,07 (oktober 2023)',
  retroactive: null,
  sellerDetails: ['Exempel Fastigheter AB, Exempelgatan 1, 753 20 Uppsala', 'Org.nr 559900-0006'],
} satisfies Props
