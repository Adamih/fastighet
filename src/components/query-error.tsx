import { Button } from '#/components/ui/button'
import { isAppError } from '#/lib/app-errors'
import { m } from '#/paraglide/messages'

export function QueryError({
  error,
  retry,
  pending = false,
}: {
  error: unknown
  retry: () => Promise<unknown>
  pending?: boolean
}) {
  return (
    <div role="alert" className="grid gap-2 text-sm">
      <p className="text-destructive">{isAppError(error) ? error.message : m.form_error_load()}</p>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          void retry()
        }}
      >
        {m.form_retry_load()}
      </Button>
    </div>
  )
}
