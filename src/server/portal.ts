import { type Effect, Exit } from 'effect'
import { appRuntime } from './live'
import { toThrowable } from './run'
import type { ProcessServices } from './services'

// Runners for Mina sidor (`features/portal`). Portal users are never company members, so portal
// programs never run through `runApp`.

/**
 * For the portal's public pages (accepting an invitation): no session or company is needed, and
 * the program finds what it acts on itself (an invitation by its code).
 */
export async function runPortalPublic<A, E>(
  program: Effect.Effect<A, E, ProcessServices>,
): Promise<A> {
  const exit = await appRuntime.runPromiseExit(program)
  if (Exit.isSuccess(exit)) return exit.value
  throw toThrowable(exit.cause)
}
