import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { requireCustomerSession } from './customer-access'

const outcome = (role?: string | null, impersonatedBy?: string | null) =>
  Effect.runPromise(
    requireCustomerSession({ user: { role }, session: { impersonatedBy } }).pipe(
      Effect.match({ onFailure: (error) => error._tag, onSuccess: () => 'allowed' }),
    ),
  )

test('staff are sent to admin even when they also have other roles', async () => {
  expect(await outcome('admin')).toBe('AdminOnly')
  expect(await outcome('user,admin')).toBe('AdminOnly')
})

test('customer accounts can enter the app', async () => {
  for (const role of [undefined, null, 'user', 'administrator']) {
    expect(await outcome(role)).toBe('allowed')
  }
})

test('an admin impersonating a customer can still use the customer app', async () => {
  expect(await outcome('user', 'staff-id')).toBe('allowed')
})
