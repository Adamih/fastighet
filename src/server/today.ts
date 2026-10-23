import { Clock, Effect } from 'effect'
import { stockholmDate } from '#/lib/dates'

/** Today's date in Sweden. Read through Effect's Clock so tests can control it with TestClock. */
export const today = Clock.currentTimeMillis.pipe(Effect.map(stockholmDate))
