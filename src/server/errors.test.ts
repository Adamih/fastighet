import { expect, test } from 'bun:test'
import * as errors from './errors'
import {
  Conflict,
  DatabaseError,
  Forbidden,
  failsBeforeWrite,
  isAppError,
  NotFound,
} from './errors'

test('every error class is in appErrors, so toThrowable maps it', () => {
  const classes = Object.values(errors).filter(
    (value) =>
      typeof value === 'function' && (value as { prototype?: unknown }).prototype instanceof Error,
  )
  expect(classes.length).toBeGreaterThan(0)
  expect(new Set<unknown>(errors.appErrors)).toEqual(new Set<unknown>(classes))
})

test('recognizes app errors by class, not by a tag string', () => {
  expect(isAppError(new Forbidden())).toBe(true)
  expect(isAppError({ _tag: 'Forbidden' })).toBe(false)
  expect(isAppError(new Error('x'))).toBe(false)
})

test('only checks and lookups count as failing before a write', () => {
  expect(failsBeforeWrite(new Conflict({ message: 'x' }))).toBe(true)
  expect(failsBeforeWrite(new Forbidden())).toBe(true)
  expect(failsBeforeWrite(new NotFound({ entity: 'invoice', id: 'i' }))).toBe(true)
  expect(failsBeforeWrite(new DatabaseError({ cause: null }))).toBe(false)
  expect(failsBeforeWrite({ _tag: 'Conflict' })).toBe(false)
})
