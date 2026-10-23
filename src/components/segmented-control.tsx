import { useId } from 'react'
import { cn } from '#/lib/utils'

/**
 * A choice between a few options shown side by side. Native radio buttons underneath, so
 * arrow keys and form semantics work as usual.
 */
export function SegmentedControl<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  name: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <fieldset disabled={disabled} className="grid gap-1.5">
      <legend className="sr-only">{label}</legend>
      <div
        className="grid gap-1 rounded-lg bg-muted p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => (
          <label key={o.value} className="relative">
            <input
              type="radio"
              id={`${id}-${o.value}`}
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex h-10 cursor-pointer items-center justify-center rounded-md px-2 text-center text-sm sm:h-9',
                'text-muted-foreground peer-checked:bg-background peer-checked:font-semibold peer-checked:text-foreground peer-checked:shadow-sm',
                'peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
              )}
            >
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
