import { m } from '#/paraglide/messages'

export type AppErrorCode =
  | 'conflict'
  | 'forbidden'
  | 'validation'
  | 'unexpected'
  | 'uncertain'
  | 'refresh'

// Plain data survives Start's serializer; Error subclasses lose everything except message.
export interface AppError {
  readonly kind: 'app-error'
  readonly code: AppErrorCode
  readonly message: string
}

export const appError = (code: AppErrorCode, message: string): AppError => ({
  kind: 'app-error',
  code,
  message,
})

export function isAppError(error: unknown): error is AppError {
  if (typeof error !== 'object' || error === null) return false
  const value = error as Partial<AppError>
  return (
    value.kind === 'app-error' &&
    typeof value.message === 'string' &&
    ['conflict', 'forbidden', 'validation', 'unexpected', 'uncertain', 'refresh'].includes(
      value.code ?? '',
    )
  )
}

export function submissionError(error: unknown): AppError {
  if (isAppError(error)) return error
  if (typeof error === 'object' && error !== null && 'isNotFound' in error) {
    return appError('conflict', m.form_error_not_found())
  }
  console.error('Form submission failed', error)
  return appError('unexpected', m.form_error_unexpected())
}

/** Reads can be repeated; permissions, missing records and business rules cannot recover that way. */
export function retryRead(failureCount: number, error: unknown): boolean {
  if (isAppError(error) && error.code !== 'unexpected') return false
  if (
    typeof error === 'object' &&
    error !== null &&
    ('isNotFound' in error || 'isRedirect' in error)
  )
    return false
  return failureCount < 2
}
