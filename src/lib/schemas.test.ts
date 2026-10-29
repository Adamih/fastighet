import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { anyStoredJson, storedJson } from './schemas'

const details = storedJson(Schema.Record(Schema.String, Schema.String))

test('stored JSON of the expected shape is decoded', () => {
  expect(details('{"name":"Anna","role":"admin"}')).toEqual({ name: 'Anna', role: 'admin' })
})

test('empty, malformed or differently shaped JSON is null, never a throw', () => {
  expect(details(null)).toBeNull()
  expect(details('')).toBeNull()
  expect(details('{not json')).toBeNull()
  expect(details('{"name":1}')).toBeNull()
  expect(details('["Anna"]')).toBeNull()
})

test('any JSON value passes through for callers that clean it themselves', () => {
  expect(anyStoredJson('{"invoice":["read"]}')).toEqual({ invoice: ['read'] })
  expect(anyStoredJson('{oops')).toBeNull()
})
