import { EmailHeading, EmailLayout, Paragraph } from './_components/EmailLayout'

export type Props = {
  code: string
  expiresInMinutes: number
}

export const subject = (props: Props) => `${props.code} är din kod till Mina sidor`

export default function SignInCode(props: Props) {
  return (
    <EmailLayout preview={`Din kod till Mina sidor: ${props.code}`}>
      <EmailHeading>Din kod till Mina sidor</EmailHeading>
      <Paragraph>Ange koden på inloggningssidan för att logga in.</Paragraph>
      <p
        style={{
          fontSize: '32px',
          fontWeight: 700,
          letterSpacing: '6px',
          margin: '24px 0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {props.code}
      </p>
      <Paragraph>
        Koden gäller i {props.expiresInMinutes} minuter. Har du inte bett om den kan du bortse från
        det här meddelandet.
      </Paragraph>
    </EmailLayout>
  )
}

SignInCode.PreviewProps = { code: '482913', expiresInMinutes: 10 } satisfies Props
