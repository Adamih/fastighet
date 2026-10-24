import { useLayoutEffect, useState } from 'react'
import { useFormDrawerContext } from '#/components/form-drawer'
import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'

/** A delete action that asks for confirmation inline, without a browser dialog. */
export function DeleteButton({
  label,
  question,
  pending,
  onConfirm,
}: {
  label: string
  question: string
  pending: boolean
  onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const drawer = useFormDrawerContext()
  const setBusy = drawer?.setBusy
  useLayoutEffect(() => {
    setBusy?.(pending)
    return () => setBusy?.(false)
  }, [setBusy, pending])
  const disabled = pending || drawer?.busy
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm">{question}</span>
      <Button type="button" variant="destructive" disabled={disabled} onClick={onConfirm}>
        {label}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setConfirming(false)}
      >
        {m.common_cancel()}
      </Button>
    </span>
  )
}
