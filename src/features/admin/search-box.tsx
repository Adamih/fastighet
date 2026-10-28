import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

/** A search field that reports what was typed after a short pause, for the admin lists. */
export function SearchBox({
  value,
  label,
  placeholder,
  onSearch,
}: {
  value: string
  label: string
  placeholder: string
  onSearch: (value: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => {
    if (text === value) return
    const timer = setTimeout(() => onSearch(text), 250)
    return () => clearTimeout(timer)
  }, [text, value, onSearch])
  return (
    <label className="flex h-11 w-full items-center gap-2 rounded-lg border bg-background px-3 md:h-10 md:max-w-sm">
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
    </label>
  )
}
