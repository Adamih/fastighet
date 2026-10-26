import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  LinkFallback,
  Paragraph,
} from './_components/EmailLayout'

export type Props = {
  senderName: string
  managingName: string
  code: string
  acceptUrl: string
  /** When the code stops working, as an ISO date. */
  expiresOn: string
}

export const subject = (props: Props) => `${props.managingName} ber om åtkomst som förvaltare`

export default function ManagementRequest(props: Props) {
  return (
    <EmailLayout
      preview={`${props.managingName} vill förvalta ert bolag på Fastighet. Ni bestämmer vad de får göra.`}
    >
      <EmailHeading>{props.managingName} ber om åtkomst</EmailHeading>
      <Paragraph>
        {props.senderName} på {props.managingName} vill förvalta ert bolag på Fastighet. Ägaren av
        ert bolag godkänner förfrågan och bestämmer vad {props.managingName} får se och göra. Ni kan
        ändra eller återkalla åtkomsten när som helst.
      </Paragraph>
      <EmailButton href={props.acceptUrl}>Granska förfrågan</EmailButton>
      <Paragraph>
        Ni kan också ange koden {props.code} under Förvaltare i Fastighet. Har ni inget konto än
        skapar ni ett för ert bolag först.
      </Paragraph>
      <LinkFallback href={props.acceptUrl} note={`Koden gäller till och med ${props.expiresOn}.`} />
    </EmailLayout>
  )
}

ManagementRequest.PreviewProps = {
  senderName: 'Frida Förvaltare',
  managingName: 'Exempel Förvaltning AB',
  code: 'KX7PM-4QDRT',
  acceptUrl: 'http://localhost:3000/management?code=KX7PM-4QDRT',
  expiresOn: '2026-11-09',
} satisfies Props
