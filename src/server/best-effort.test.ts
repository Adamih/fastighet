import { expect, test } from 'bun:test'
import { Effect, Option } from 'effect'
import { bestEffort, forEachBestEffort } from './best-effort'

test('a success gives Some, a failure or defect gives None', async () => {
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(effect.pipe(bestEffort('test')))
  expect(await run(Effect.succeed(1))).toEqual(Option.some(1))
  expect(await run(Effect.fail('no'))).toEqual(Option.none())
  expect(await run(Effect.die('boom'))).toEqual(Option.none())
})

test('a batch keeps going past failures and names the items', async () => {
  const result = await Effect.runPromise(
    forEachBestEffort(
      ['a', 'b', 'c'],
      (item) => (item === 'b' ? Effect.fail('no') : Effect.succeed(item.toUpperCase())),
      { label: 'test', concurrency: 2 },
    ),
  )
  expect(result).toEqual({
    succeeded: [
      { item: 'a', value: 'A' },
      { item: 'c', value: 'C' },
    ],
    failed: ['b'],
  })
})
