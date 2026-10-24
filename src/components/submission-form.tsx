import { isRedirect, useRouter } from '@tanstack/react-router'
import { type ComponentProps, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { type AppError, submissionError } from '#/lib/app-errors'
import { m } from '#/paraglide/messages'

/** Catches after TanStack has recorded the failed attempt and released isSubmitting. */
export async function submitForm(
  submit: () => Promise<unknown>,
  onError: (error: AppError) => void,
): Promise<void> {
  try {
    await submit()
  } catch (error) {
    onError(submissionError(error))
  }
}

export function SubmissionForm({
  form,
  children,
  disabled = false,
  ...props
}: Omit<ComponentProps<'form'>, 'onSubmit'> & {
  form: { handleSubmit: () => Promise<unknown> }
  disabled?: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<AppError | null>(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const summary = useRef<HTMLDivElement>(null)
  const attempt = () => {
    if (pending.current || disabled) return
    pending.current = true
    setBusy(true)
    setError(null)
    void submitForm(
      async () => {
        try {
          await form.handleSubmit()
        } catch (failure) {
          if (!isRedirect(failure)) throw failure
          failure.options._fromLocation = router.stores.location.get()
          await router.navigate(router.resolveRedirect(failure).options)
        }
      },
      (failure) => {
        setError(failure)
        requestAnimationFrame(() => summary.current?.focus())
      },
    ).finally(() => {
      pending.current = false
      setBusy(false)
    })
  }
  return (
    <form
      {...props}
      onSubmit={(event) => {
        event.preventDefault()
        attempt()
      }}
    >
      {error && (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="grid gap-1 rounded-md border border-destructive/30 p-3 text-destructive text-sm"
        >
          <p>{error.message}</p>
          {error.code === 'refresh' && (
            <Button type="button" variant="outline" disabled={busy} onClick={attempt}>
              {m.form_retry_refresh()}
            </Button>
          )}
          {(error.code === 'unexpected' || error.code === 'uncertain') && (
            <p>{m.form_error_check_before_retry()}</p>
          )}
        </div>
      )}
      <fieldset disabled={disabled || busy || error?.code === 'refresh'} className="contents">
        {children}
      </fieldset>
    </form>
  )
}
