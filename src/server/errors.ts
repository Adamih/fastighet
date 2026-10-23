import { Data } from 'effect'

export class Unauthenticated extends Data.TaggedError('Unauthenticated') {}

/** Signed in, but no company selected (or no longer a member of the selected one). */
export class NoActiveOrganization extends Data.TaggedError('NoActiveOrganization') {}

export class NotFound extends Data.TaggedError('NotFound')<{
  readonly entity: string
  readonly id: string
}> {}

/** A business-rule violation whose message is safe to show to the user. */
export class Conflict extends Data.TaggedError('Conflict')<{ readonly message: string }> {}

export class DatabaseError extends Data.TaggedError('DatabaseError')<{ readonly cause: unknown }> {}
