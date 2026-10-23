import type { AnyFieldApi } from '@tanstack/react-form'
import type { HTMLAttributes, ReactNode } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export function FieldError({ field }: { field: AnyFieldApi }) {
  const [error] = field.state.meta.errors
  if (!error) return null
  return (
    <p className="text-destructive text-sm">{typeof error === 'string' ? error : error.message}</p>
  )
}

export function TextField({
  field,
  label,
  type = 'text',
  placeholder,
  autoComplete,
  inputMode,
  hint,
  id = field.name,
}: {
  field: AnyFieldApi
  label: ReactNode
  type?: string
  placeholder?: string
  autoComplete?: string
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
  /** A short help line under the input. */
  hint?: string
  /** Defaults to the field name; set it when the same form can be on the page twice. */
  id?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={field.name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-11 sm:h-9"
        value={field.state.value ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      <FieldError field={field} />
    </div>
  )
}
