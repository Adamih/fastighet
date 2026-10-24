import { expect, test } from 'bun:test'
import { FormApi } from '@tanstack/react-form'
import { appError } from '#/lib/app-errors'
import { submitForm } from './submission-form'

test('a failed attempt releases pending state and preserves values for resubmission', async () => {
  let attempts = 0
  const error = appError('conflict', 'Already occupied')
  const form = new FormApi({
    defaultValues: { name: 'Original' },
    onSubmit: async () => {
      if (++attempts === 1) throw error
    },
  })
  form.mount()
  form.setFieldValue('name', 'Kept edit')
  const failures: unknown[] = []
  await submitForm(
    () => form.handleSubmit(),
    (failure) => failures.push(failure),
  )
  expect(failures).toEqual([error])
  expect(form.state.isSubmitSuccessful).toBe(false)
  expect(form.state.isSubmitting).toBe(false)
  expect(form.state.values.name).toBe('Kept edit')
  await submitForm(
    () => form.handleSubmit(),
    (failure) => failures.push(failure),
  )
  expect(form.state.isSubmitSuccessful).toBe(true)
  expect(form.state.isSubmitting).toBe(false)
  expect(attempts).toBe(2)
  expect(failures).toHaveLength(1)
})
