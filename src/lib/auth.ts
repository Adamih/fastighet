import { env, waitUntil } from 'cloudflare:workers'
import { Effect } from 'effect'
import { db } from '#/db'
import { auditEvent } from '#/db/schema'
import { syncQuantity } from '#/features/billing/store'
import { auditValues } from '#/server/audit'
import { Mailer, sendEmail } from '#/server/mail/mailer'
import { mailer } from '#/server/mail/provider'
import { createAuth, type DeliverEmail, type RecordCompanyEvent } from './auth-config'
import { stripe, stripeWebhookSecret } from './stripe'

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

/**
 * Team and subscription changes go to the company's audit log like other writes, with the company
 * itself as the acting company: only its own members can change its team or plan.
 */
const recordCompanyEvent: RecordCompanyEvent = async (event) => {
  try {
    const values = auditValues(
      {
        organizationId: event.organization.id,
        user: event.actor ?? { id: '', name: '' },
        actor: event.organization,
      },
      { action: event.action, entityId: event.entityId, details: event.details },
    )
    await db
      .insert(auditEvent)
      .values(event.actor ? values : { ...values, userId: null, userName: '' })
  } catch (cause) {
    console.error('Could not record company audit event', cause)
  }
}

export const auth = createAuth(db, {
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  deliverEmail,
  recordCompanyEvent,
  stripe: { client: stripe, webhookSecret: stripeWebhookSecret },
  // Never fails the webhook: a quantity left behind is corrected by the next change.
  syncQuantity: (organizationId) =>
    syncQuantity(db, stripe, organizationId).catch((cause) =>
      console.error('Could not sync the subscription quantity', cause),
    ),
})
