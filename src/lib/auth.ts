import { env, waitUntil } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { db } from '#/db'
import { adminEvent, auditEvent, user } from '#/db/schema'
import { syncQuantity } from '#/features/billing/store'
import { auditValues } from '#/server/audit'
import { Mailer, sendEmail } from '#/server/mail/mailer'
import { mailer } from '#/server/mail/provider'
import {
  createAuth,
  type DeliverEmail,
  type RecordAdminEvent,
  type RecordCompanyEvent,
} from './auth-config'
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
    const [admin] = event.impersonatedById
      ? await db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(eq(user.id, event.impersonatedById))
      : []
    const values = auditValues(
      {
        organizationId: event.organization.id,
        user: { ...(event.actor ?? { id: '', name: '' }), impersonatedBy: admin ?? null },
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

const recordAdminEvent: RecordAdminEvent = async (event) => {
  try {
    await db.insert(adminEvent).values({
      actorUserId: event.actor.id,
      actorName: event.actor.name,
      action: event.action,
      targetUserId: event.targetUserId,
      details: JSON.stringify(event.details),
    })
  } catch (cause) {
    console.error('Could not record admin event', cause)
  }
}

export const auth = createAuth(db, {
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  deliverEmail,
  recordCompanyEvent,
  recordAdminEvent,
  stripe: { client: stripe, webhookSecret: stripeWebhookSecret },
  // Never fails the webhook: a quantity left behind is corrected by the next change.
  syncQuantity: (organizationId) =>
    syncQuantity(db, stripe, organizationId).catch((cause) =>
      console.error('Could not sync the subscription quantity', cause),
    ),
})
