import { Data } from 'effect'

export class Unauthenticated extends Data.TaggedError('Unauthenticated') {}

/** Fastighet staff use the admin dashboard, unless acting as a customer. */
export class AdminOnly extends Data.TaggedError('AdminOnly') {}

/** Signed in, but no company selected (or no longer a member of the selected one). */
export class NoActiveOrganization extends Data.TaggedError('NoActiveOrganization') {}

export class NotFound extends Data.TaggedError('NotFound')<{
  readonly entity: string
  readonly id: string
}> {}

/**
 * The company asked for (`?company=`) is neither the user's own nor one their company manages
 * with them assigned, e.g. after a grant was revoked. `runApp` sends them back to their own company.
 */
export class CompanyNotInScope extends Data.TaggedError('CompanyNotInScope') {}

/** The user's role in the company does not allow this action. */
export class Forbidden extends Data.TaggedError('Forbidden') {}

/** A business-rule violation whose message is safe to show to the user. */
export class Conflict extends Data.TaggedError('Conflict')<{ readonly message: string }> {}

export class DatabaseError extends Data.TaggedError('DatabaseError')<{ readonly cause: unknown }> {}

/** The write may have completed; repeating it could duplicate a record or delivery. */
export class UncertainSubmission extends Data.TaggedError('UncertainSubmission') {}

/**
 * Every error above. `toThrowable` (run.ts) maps each one exhaustively, so a new error class goes
 * here too; a missing one fails `errors.test.ts`.
 */
export const appErrors = [
  Unauthenticated,
  AdminOnly,
  NoActiveOrganization,
  NotFound,
  CompanyNotInScope,
  Forbidden,
  Conflict,
  DatabaseError,
  UncertainSubmission,
] as const

export type AppError = InstanceType<(typeof appErrors)[number]>

export const isAppError = (error: unknown): error is AppError =>
  appErrors.some((type) => error instanceof type)

/**
 * Failures a program raises before it writes anything (checks and lookups), so repeating the
 * request is safe: `once()` releases its claim on them. Anything else may follow a write.
 */
export const failsBeforeWrite = (error: unknown): error is Conflict | Forbidden | NotFound =>
  error instanceof Conflict || error instanceof Forbidden || error instanceof NotFound
