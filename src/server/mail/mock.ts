import { Effect } from 'effect'
import type { EmailMessage, Mailer } from './mailer'

export interface SentEmail extends EmailMessage {
  readonly from: string
  readonly sentAt: Date
}

/**
 * A provider that delivers nothing. It logs each email (including the plain-text body, so links
 * such as password resets can be followed in dev) and keeps the latest ones in `outbox`.
 * Never use it in production: the logs would contain reset links.
 */
export function makeMockMailer(options: { from: string; keep?: number }) {
  const keep = options.keep ?? 50
  const outbox: SentEmail[] = []

  const mailer: Mailer['Service'] = {
    send: (message) =>
      Effect.gen(function* () {
        const sent: SentEmail = { ...message, from: options.from, sentAt: new Date() }
        outbox.push(sent)
        if (outbox.length > keep) outbox.splice(0, outbox.length - keep)
        yield* Effect.logInfo(`[mock mailer] ${message.subject}`).pipe(
          Effect.annotateLogs({ to: message.to, from: options.from, text: message.text }),
        )
      }),
  }

  return { mailer, outbox }
}
