import type { AnyFieldApi } from '@tanstack/react-form'
import { FieldError } from '#/components/text-field'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

export function SelectField({
  field,
  label,
  options,
  placeholder,
  disabled,
  id = field.name,
}: {
  field: AnyFieldApi
  label: string
  options: readonly { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
  /** Defaults to the field name; set it when the same form can be on the page twice. */
  id?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        disabled={disabled}
        value={field.state.value || undefined}
        onValueChange={(v) => field.handleChange(v)}
      >
        <SelectTrigger
          id={id}
          className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError field={field} />
    </div>
  )
}

/** `{ monthly: 'Månadsvis' }` → `[{ value: 'monthly', label: 'Månadsvis' }]` */
export const optionsFrom = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))
