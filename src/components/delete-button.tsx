import { useState } from 'react'
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
  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        {label}
      </Button>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm">{question}</span>
      <Button variant="destructive" disabled={pending} onClick={onConfirm}>
        {label}
      </Button>
      <Button variant="outline" onClick={() => setConfirming(false)}>
        {m.common_cancel()}
      </Button>
    </span>
  )
}
