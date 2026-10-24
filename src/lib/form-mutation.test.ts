import { describe, expect, spyOn, test } from 'bun:test'
import { createMutationRunner } from './form-mutation'

describe('form mutation recovery', () => {
  test('a rejected write can be resubmitted', async () => {
    const run = createMutationRunner<string, string>()
    let attempts = 0
    const write = async (value: string) => {
      if (++attempts === 1) throw new Error('offline')
      return value
    }
    await expect(run('kept values', write)).rejects.toThrow('offline')
    expect(await run('kept values', write)).toBe('kept values')
    expect(attempts).toBe(2)
  })

  test('retries completion without repeating a successful write, even if values changed', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const run = createMutationRunner<string, string>()
      let writes = 0
      let refreshes = 0
      const write = async (value: string) => {
        writes++
        return value
      }
      const refresh = async () => {
        if (++refreshes === 1) throw new Error('refresh failed')
      }
      await expect(run('saved', write, refresh)).rejects.toMatchObject({ code: 'refresh' })
      expect(await run('edited while retrying', write, refresh)).toBe('saved')
      expect(writes).toBe(1)
      expect(refreshes).toBe(2)
      expect(await run('new save', write, refresh)).toBe('new save')
      expect(writes).toBe(2)
    } finally {
      log.mockRestore()
    }
  })
})
