import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  LinkFallback,
  Paragraph,
} from './_components/EmailLayout'

export type Props = {
  inviterName: string
  organizationName: string
  acceptUrl: string
  /** When the invitation stops working, as an ISO date. */
  expiresOn: string
}

export const subject = (props: Props) =>
  `${props.inviterName} har bjudit in dig till ${props.organizationName}`

export default function OrganizationInvitation(props: Props) {
  return (
    <EmailLayout
      preview={`Gå med i ${props.organizationName} på Fastighet och hantera fastigheter tillsammans.`}
    >
      <EmailHeading>Du har blivit inbjuden till {props.organizationName}</EmailHeading>
      <Paragraph>
        {props.inviterName} vill att du går med i {props.organizationName} på Fastighet, där ni
        hanterar fastigheter, hyresgäster och avtal tillsammans.
      </Paragraph>
      <EmailButton href={props.acceptUrl}>Acceptera inbjudan</EmailButton>
      <LinkFallback
        href={props.acceptUrl}
        note={`Inbjudan gäller till och med ${props.expiresOn}.`}
      />
    </EmailLayout>
  )
}

OrganizationInvitation.PreviewProps = {
  inviterName: 'Erik Lindqvist',
  organizationName: 'Exempel Fastigheter AB',
  acceptUrl: 'http://localhost:3000/invitations/preview',
  expiresOn: '2026-10-30',
} satisfies Props
