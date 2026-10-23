import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  LinkFallback,
  Paragraph,
} from './_components/EmailLayout'

export type Props = {
  name: string
  verifyUrl: string
}

export const subject = (_props: Props) => 'Bekräfta din e-postadress'

export default function VerifyEmail(props: Props) {
  return (
    <EmailLayout preview="Bekräfta din e-postadress för att komma igång med Fastighet.">
      <EmailHeading>Bekräfta din e-postadress</EmailHeading>
      <Paragraph>Hej {props.name}!</Paragraph>
      <Paragraph>Klicka på knappen nedan för att bekräfta din e-postadress.</Paragraph>
      <EmailButton href={props.verifyUrl}>Bekräfta e-postadress</EmailButton>
      <LinkFallback
        href={props.verifyUrl}
        note="Har du inte skapat ett konto kan du bortse från det här meddelandet."
      />
    </EmailLayout>
  )
}

VerifyEmail.PreviewProps = {
  name: 'Anna',
  verifyUrl: 'http://localhost:3000/api/auth/verify-email?token=preview',
} satisfies Props
