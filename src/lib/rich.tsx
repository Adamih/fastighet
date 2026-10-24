import type { ReactNode } from 'react'

const MARKER = '⁣' // invisible separator, never part of real copy

/**
 * Renders a message with one value shown as an element, keeping the whole sentence in a single
 * message so translations can reorder it: `rich((email) => m.x({ email }), <strong>{email}</strong>)`.
 */
export function rich(message: (value: string) => string, node: ReactNode): ReactNode {
  const [before, after = ''] = message(MARKER).split(MARKER)
  return (
    <>
      {before}
      {node}
      {after}
    </>
  )
}
