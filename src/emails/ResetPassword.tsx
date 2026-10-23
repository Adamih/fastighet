import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  LinkFallback,
  Paragraph,
} from './_components/EmailLayout'

export type Props = {
  name: string
  resetUrl: string
  /** How long the link works, for the copy. */
  expiresInMinutes: number
}

export const subject = (_props: Props) => 'Återställ ditt lösenord'

export default function ResetPassword(props: Props) {
  return (
    <EmailLayout preview="Någon har begärt att återställa lösenordet för ditt konto.">
      <EmailHeading>Återställ ditt lösenord</EmailHeading>
      <Paragraph>Hej {props.name}!</Paragraph>
      <Paragraph>
        Vi har fått en begäran om att återställa lösenordet för ditt konto. Länken fungerar i{' '}
        {props.expiresInMinutes} minuter.
      </Paragraph>
      <EmailButton href={props.resetUrl}>Välj nytt lösenord</EmailButton>
      <LinkFallback
        href={props.resetUrl}
        note="Har du inte bett om det här kan du bortse från meddelandet. Ditt lösenord ändras inte."
      />
    </EmailLayout>
  )
}

ResetPassword.PreviewProps = {
  name: 'Anna',
  resetUrl: 'http://localhost:3000/reset-password?token=preview',
  expiresInMinutes: 60,
} satisfies Props
