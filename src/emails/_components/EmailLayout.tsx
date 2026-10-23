import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { ReactNode } from 'react'

// Inline styles only: many email clients ignore <style> blocks and CSS variables.

const colors = {
  page: '#f4f4f5',
  card: '#ffffff',
  text: '#18181b',
  muted: '#71717a',
  border: '#e4e4e7',
  button: '#18181b',
  buttonText: '#fafafa',
}

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="sv">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, backgroundColor: colors.page, fontFamily, color: colors.text }}>
        <Container style={{ maxWidth: '560px', padding: '32px 16px' }}>
          <Text style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 16px' }}>Fastighet</Text>
          <Section
            style={{
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '32px',
            }}
          >
            {children}
          </Section>
          <Text
            style={{
              fontSize: '12px',
              lineHeight: '18px',
              color: colors.muted,
              margin: '16px 0 0',
            }}
          >
            Det här är ett automatiskt meddelande från Fastighet. Svara inte på det.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h1"
      style={{ fontSize: '22px', lineHeight: '30px', fontWeight: 600, margin: '0 0 16px' }}
    >
      {children}
    </Heading>
  )
}

export function Paragraph({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' }}>{children}</Text>
  )
}

export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ padding: '8px 0 16px' }}>
      <Button
        href={href}
        style={{
          backgroundColor: colors.button,
          color: colors.buttonText,
          borderRadius: '6px',
          fontSize: '15px',
          fontWeight: 500,
          padding: '12px 20px',
          textDecoration: 'none',
        }}
      >
        {children}
      </Button>
    </Section>
  )
}

/** Small print under the button: the raw link for clients that block buttons, plus a note. */
export function LinkFallback({ href, note }: { href: string; note?: ReactNode }) {
  return (
    <>
      <Hr style={{ borderColor: colors.border, margin: '8px 0 16px' }} />
      <Text style={{ fontSize: '13px', lineHeight: '20px', color: colors.muted, margin: 0 }}>
        Fungerar inte knappen? Kopiera länken:{' '}
        <span style={{ wordBreak: 'break-all' }}>{href}</span>
      </Text>
      {note && (
        <Text
          style={{ fontSize: '13px', lineHeight: '20px', color: colors.muted, margin: '8px 0 0' }}
        >
          {note}
        </Text>
      )}
    </>
  )
}
