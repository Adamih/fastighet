import { Effect } from 'effect'
import { auditEvent } from '#/db/schema'
import type { Audit } from '#/features/audit/actions'
import { query } from './scoped'

export interface AuditContext {
  readonly organizationId: string
  readonly user: { readonly id: string; readonly name: string }
  readonly actor: { readonly id: string; readonly name: string }
}

/** The id a write returned, for creates: `{ id }`, or `{ <something>: { id } }`. */
const resultId = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') return null
  if ('id' in result && typeof result.id === 'string') return result.id
  return null
}

/**
 * Records a successful write in the company's audit log. A failure is logged, never thrown: the
 * write has already happened and the user should hear that it did.
 */
export const recordAudit = (context: AuditContext, audit: Audit, result: unknown) =>
  query((db) =>
    db.insert(auditEvent).values({
      organizationId: context.organizationId,
      userId: context.user.id,
      userName: context.user.name,
      actorOrganizationId: context.actor.id,
      actorOrganizationName: context.actor.name,
      action: audit.action,
      entityId: audit.entityId === undefined ? resultId(result) : audit.entityId,
    }),
  ).pipe(Effect.catchCause((cause) => Effect.logError('Could not record audit event', cause)))
