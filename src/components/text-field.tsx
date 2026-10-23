import type { AnyFieldApi } from '@tanstack/react-form'
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
}: {
  field: AnyFieldApi
  label: string
  type?: string
  placeholder?: string
  autoComplete?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={field.state.value ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      <FieldError field={field} />
    </div>
  )
}
