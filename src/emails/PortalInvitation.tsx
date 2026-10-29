import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  LinkFallback,
  Paragraph,
} from './_components/EmailLayout'

export type Props = {
  organizationName: string
  /** Who the pages are for: the party's name. */
  partyName: string
  /** "hyresgäst" or "medlem", after the company type. */
  partyNoun: string
  acceptUrl: string
  /** When the invitation stops working, as an ISO date. */
  expiresOn: string
}

export const subject = (props: Props) => `Mina sidor hos ${props.organizationName}`

export default function PortalInvitation(props: Props) {
  return (
    <EmailLayout preview={`Se dina avtal och avier hos ${props.organizationName} på Mina sidor.`}>
      <EmailHeading>Välkommen till Mina sidor</EmailHeading>
      <Paragraph>
        {props.organizationName} har bjudit in dig till Mina sidor för {props.partyName}. Där ser du
        som {props.partyNoun} dina avtal, avier och betalningar, och kan hålla dina kontaktuppgifter
        aktuella.
      </Paragraph>
      <Paragraph>
        Du loggar in med en kod som vi skickar till din e-post, inget lösenord behövs.
      </Paragraph>
      <EmailButton href={props.acceptUrl}>Öppna Mina sidor</EmailButton>
      <LinkFallback
        href={props.acceptUrl}
        note={`Inbjudan gäller till och med ${props.expiresOn}.`}
      />
    </EmailLayout>
  )
}

PortalInvitation.PreviewProps = {
  organizationName: 'Exempel Fastigheter AB',
  partyName: 'Anna Svensson',
  partyNoun: 'hyresgäst',
  acceptUrl: 'http://localhost:3000/portal/invitation?code=preview',
  expiresOn: '2026-11-12',
} satisfies Props
