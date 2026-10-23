import { initials } from '#/lib/initials'
import { cn } from '#/lib/utils'

/** A round avatar with the name's initials; `square` marks companies. Decorative only. */
export function InitialsAvatar({
  name,
  square = false,
  className,
}: {
  name: string
  square?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-9 shrink-0 items-center justify-center bg-accent font-semibold text-[13px] text-accent-foreground',
        square ? 'rounded-lg' : 'rounded-full',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
