import { env } from 'cloudflare:workers'
import { makeMockMailer } from './mock'

// The one place that decides which provider delivers email. Only the mock exists so far; swap
// in a real provider here (and keep the mock for dev and tests) when sending goes live.
export const { mailer, outbox } = makeMockMailer({ from: env.MAIL_FROM })
