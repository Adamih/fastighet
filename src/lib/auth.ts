import { env, waitUntil } from 'cloudflare:workers'
import { Effect } from 'effect'
import { db } from '#/db'
import { Mailer, sendEmail } from '#/server/mail/mailer'
import { mailer } from '#/server/mail/provider'
import { createAuth, type DeliverEmail } from './auth-config'

// waitUntil keeps the Worker alive until the email is handed off, after the response is sent.
const deliverEmail: DeliverEmail = (email) =>
  waitUntil(
    Effect.runPromise(
      sendEmail(email).pipe(
        Effect.provideService(Mailer, mailer),
        Effect.catchCause((cause) =>
          Effect.logError(`Could not send ${email.template} email`, cause),
        ),
      ),
    ),
  )

export const auth = createAuth(db, {
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  deliverEmail,
})
