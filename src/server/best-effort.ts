import { Effect, Option } from 'effect'

// Side effects that must not fail the program they belong to, typically an email after a write
// that has already happened. A failure is logged with a label and the program carries on; the
// caller decides what to record about it (a pledge not yet confirmed, a notice not sent, …).

/** Runs `self`, giving `Some` of its value, or `None` after logging a failure under `label`. */
export const bestEffort =
  (label: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<Option.Option<A>, never, R> =>
    self.pipe(
      Effect.map(Option.some),
      Effect.catchCause((cause) => Effect.logError(label, cause).pipe(Effect.as(Option.none()))),
    )

/**
 * Runs `f` for each item, a few at a time; one failure doesn't stop the others. Each failure is
 * logged under `label` with its item.
 */
export const forEachBestEffort = <I, A, E, R>(
  items: Iterable<I>,
  f: (item: I) => Effect.Effect<A, E, R>,
  options: { readonly label: string; readonly concurrency: number },
) =>
  Effect.gen(function* () {
    const list = [...items]
    const results = yield* Effect.forEach(
      list,
      (item) => f(item).pipe(bestEffort(`${options.label} (${String(item)})`)),
      { concurrency: options.concurrency },
    )
    const succeeded: { readonly item: I; readonly value: A }[] = []
    const failed: I[] = []
    results.forEach((result, index) => {
      if (Option.isSome(result)) succeeded.push({ item: list[index], value: result.value })
      else failed.push(list[index])
    })
    return { succeeded, failed }
  })
