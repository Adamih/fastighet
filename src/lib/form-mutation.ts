import { useMutation } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { m } from '#/paraglide/messages'
import { appError } from './app-errors'

/** Keep the successful write while recovery repeats only cache refresh/navigation. */
export function createMutationRunner<TData, TVariables>() {
  let completed: { data: TData } | undefined
  return async (
    variables: TVariables,
    write: (variables: TVariables) => Promise<TData>,
    finish?: (data: TData) => unknown | Promise<unknown>,
  ): Promise<TData> => {
    if (!completed) completed = { data: await write(variables) }
    const { data } = completed
    try {
      await finish?.(data)
    } catch (error) {
      console.error('Post-save refresh failed', error)
      throw appError('refresh', m.form_refresh_failed())
    }
    completed = undefined
    return data
  }
}

export function useFormMutation<TData, TVariables>({
  mutationFn,
  onSuccess,
}: {
  mutationFn: (variables: TVariables) => Promise<TData>
  onSuccess?: (data: TData) => unknown | Promise<unknown>
}) {
  const runner = useRef(createMutationRunner<TData, TVariables>())
  const request = useRef<{ payload: string; id: string } | null>(null)
  const mutation = useMutation({
    mutationFn: async (variables: TVariables) => {
      const payload = JSON.stringify(variables)
      if (!request.current || request.current.payload !== payload) {
        request.current = { payload, id: crypto.randomUUID() }
      }
      const keyed =
        typeof variables === 'object' && variables !== null && 'data' in variables
          ? { ...variables, data: { ...(variables.data as object), requestId: request.current.id } }
          : variables
      const data = await runner.current(keyed, mutationFn, onSuccess)
      request.current = null
      return data
    },
    retry: false,
  })
  const reset = useCallback(() => {
    runner.current = createMutationRunner<TData, TVariables>()
    request.current = null
    mutation.reset()
  }, [mutation.reset])
  return { ...mutation, reset }
}
