/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import RentInvoice from '#/emails/RentInvoice'
import { Mailer, MailerError, renderEmail, sendEmail } from './mailer'
import { makeMockMailer } from './mock'

const invitation = {
  inviterName: 'Erik Lindqvist',
  organizationName: 'Exempel Fastigheter AB',
  acceptUrl: 'https://app.example.se/invitations/abc123',
  expiresOn: '2026-10-30',
}

describe('sendEmail with the mock mailer', () => {
  test('renders the template and records the message', async () => {
    const { mailer, outbox } = makeMockMailer({ from: 'Fastighet <no-reply@example.se>' })

    await Effect.runPromise(
      sendEmail({
        to: 'anna@example.se',
        template: 'organizationInvitation',
        props: invitation,
      }).pipe(Effect.provideService(Mailer, mailer)),
    )

    expect(outbox).toHaveLength(1)
    const [sent] = outbox
    expect(sent.to).toBe('anna@example.se')
    expect(sent.from).toBe('Fastighet <no-reply@example.se>')
    expect(sent.subject).toBe('Erik Lindqvist har bjudit in dig till Exempel Fastigheter AB')
    expect(sent.html).toMatch(/<html[^>]* lang="sv"/)
    expect(sent.html).toContain('href="https://app.example.se/invitations/abc123"')
    expect(sent.text).toContain('https://app.example.se/invitations/abc123')
    expect(sent.text).toContain('Inbjudan gäller till och med 2026-10-30.')
    expect(sent.text).not.toContain('<')
  })

  test('keeps only the latest messages', async () => {
    const { mailer, outbox } = makeMockMailer({ from: 'x@example.se', keep: 2 })
    const send = (to: string) =>
      sendEmail({
        to,
        template: 'verifyEmail',
        props: { name: 'A', verifyUrl: 'https://example.se/v' },
      }).pipe(Effect.provideService(Mailer, mailer))

    await Effect.runPromise(Effect.all([send('1@x.se'), send('2@x.se'), send('3@x.se')]))
    expect(outbox.map((m) => m.to)).toEqual(['2@x.se', '3@x.se'])
  })
})

test('every template renders to HTML and plain text', async () => {
  const cases = [
    renderEmail('verifyEmail', { name: 'Anna', verifyUrl: 'https://example.se/verify' }),
    renderEmail('resetPassword', {
      name: 'Anna',
      resetUrl: 'https://example.se/reset',
      expiresInMinutes: 60,
    }),
    renderEmail('organizationInvitation', invitation),
    renderEmail('rentInvoice', RentInvoice.PreviewProps),
  ]
  for (const rendered of await Effect.runPromise(Effect.all(cases))) {
    expect(rendered.subject.length).toBeGreaterThan(0)
    expect(rendered.html).toContain('Fastighet')
    expect(rendered.text.length).toBeGreaterThan(0)
  }
})

test('provider failures surface as MailerError', async () => {
  const failing: Mailer['Service'] = {
    send: () => Effect.fail(new MailerError({ reason: 'send', cause: new Error('503') })),
  }
  const exit = await Effect.runPromiseExit(
    sendEmail({
      to: 'anna@example.se',
      template: 'verifyEmail',
      props: { name: 'Anna', verifyUrl: 'https://example.se/v' },
    }).pipe(Effect.provideService(Mailer, failing)),
  )
  expect(Exit.isFailure(exit)).toBe(true)
  expect(JSON.stringify(exit)).toContain('MailerError')
})
