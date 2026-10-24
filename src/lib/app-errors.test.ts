import { expect, spyOn, test } from 'bun:test'
import { appError, isAppError, retryRead, submissionError } from './app-errors'

test('safe structured errors survive JSON transport', () => {
  const error = appError('conflict', 'Objektet är redan uthyrt')
  const transported = JSON.parse(JSON.stringify(error))
  expect(isAppError(transported)).toBe(true)
  expect(submissionError(transported)).toEqual(error)
})

test('unexpected errors do not expose internal messages', () => {
  const log = spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(submissionError(new Error('SQL secret')).message).not.toContain('SQL secret')
    expect(log).toHaveBeenCalledTimes(1)
  } finally {
    log.mockRestore()
  }
})

test('reads retry transient failures twice, but never business or routing errors', () => {
  expect(retryRead(0, new Error('network'))).toBe(true)
  expect(retryRead(1, appError('unexpected', 'temporary'))).toBe(true)
  expect(retryRead(2, new Error('network'))).toBe(false)
  for (const code of ['conflict', 'forbidden', 'validation', 'uncertain'] as const) {
    expect(retryRead(0, appError(code, 'failure'))).toBe(false)
  }
  expect(retryRead(0, { isNotFound: true })).toBe(false)
  expect(retryRead(0, { isRedirect: true })).toBe(false)
})
