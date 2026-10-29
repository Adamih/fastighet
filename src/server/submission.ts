import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { submission } from '#/db/schema'
import type { Permissions } from '#/lib/permissions'
import { decodeSubmissionResult, encodeSubmissionResult } from '#/lib/submission-result'
import { inCompany } from '#/server/scoped'
import { requirePermission } from './authorize'
import { Conflict, failsBeforeWrite, UncertainSubmission } from './errors'
import { orgQuery } from './scoped'
import { type AppServices, CurrentUser, SubmissionReplay } from './services'

/**
 * Claim before executing. A stored result is replayable; an unfinished claim requires review.
 * This deliberately favours an uncertain outcome over repeating a possibly completed write.
 */
export function once<A, E, Input extends { requestId?: string }>(
  operation: string,
  input: Input,
  permissions: Permissions,
  program: Effect.Effect<A, E, AppServices>,
) {
  return Effect.gen(function* () {
    yield* requirePermission(permissions)
    const user = yield* CurrentUser
    const { requestId = crypto.randomUUID(), ...payload } = input
    const encoded = JSON.stringify(payload)
    const scope = (organizationId: string) =>
      inCompany(
        submission,
        organizationId,
        eq(submission.userId, user.id),
        eq(submission.operation, operation),
        eq(submission.requestId, requestId),
      )
    const claimed = yield* orgQuery((db, organizationId) =>
      db
        .insert(submission)
        .values({
          organizationId,
          userId: user.id,
          operation,
          requestId,
          payload: encoded,
        })
        .onConflictDoNothing()
        .returning(),
    )
    if (claimed.length === 0) {
      const [previous] = yield* orgQuery((db, organizationId) =>
        db.select().from(submission).where(scope(organizationId)),
      )
      if (!previous || previous.payload !== encoded) {
        return yield* new Conflict({
          message: 'Begäran har ändrats. Kontrollera resultatet innan du försöker igen.',
        })
      }
      if (previous.result === null)
        return yield* new UncertainSubmission()
        // Nothing was written this time; the first request already recorded the write.
      ;(yield* SubmissionReplay).mark()
      return decodeSubmissionResult<A>(previous.result)
    }
    const result = yield* program.pipe(
      Effect.catchIf(
        // These failures happen before the command writes. Unexpected/database failures retain
        // the claim, because the operation or one of its batches may already have committed.
        failsBeforeWrite,
        (error) =>
          Effect.gen(function* () {
            yield* orgQuery((db, organizationId) =>
              db.delete(submission).where(scope(organizationId)),
            )
            return yield* Effect.fail(error)
          }),
      ),
    )
    yield* orgQuery((db, organizationId) =>
      db
        .update(submission)
        .set({ result: encodeSubmissionResult(result) })
        .where(scope(organizationId)),
    )
    return result
  })
}
