import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  LinkFallback,
  Paragraph,
} from './_components/EmailLayout'

// Sent to the current address when someone asks to change an account's email (account settings).
// The change only happens once this is approved and the new address is confirmed, so a stolen
// session can't move the account to another inbox.
export type Props = {
  name: string
  newEmail: string
  confirmUrl: string
}

export const subject = (_props: Props) => 'Godkänn byte av e-postadress'

export default function ConfirmEmailChange(props: Props) {
  return (
    <EmailLayout preview={`Någon vill byta e-postadress på ditt konto till ${props.newEmail}.`}>
      <EmailHeading>Godkänn byte av e-postadress</EmailHeading>
      <Paragraph>Hej {props.name}!</Paragraph>
      <Paragraph>
        Någon har bett om att byta e-postadressen för ditt konto till {props.newEmail}. Godkänn
        bytet med knappen. Sedan får den nya adressen ett mejl att bekräfta.
      </Paragraph>
      <EmailButton href={props.confirmUrl}>Godkänn bytet</EmailButton>
      <LinkFallback
        href={props.confirmUrl}
        note="Har du inte bett om det här ska du inte klicka på länken. Byt gärna lösenord."
      />
    </EmailLayout>
  )
}

ConfirmEmailChange.PreviewProps = {
  name: 'Anna',
  newEmail: 'anna.ny@exempel.se',
  confirmUrl: 'http://localhost:3000/api/auth/verify-email?token=preview',
} satisfies Props
