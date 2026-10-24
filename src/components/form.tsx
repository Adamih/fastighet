import { createFormHook, createFormHookContexts, useStore } from '@tanstack/react-form'
import { type HTMLAttributes, type ReactNode, useEffect, useId } from 'react'
import { useFormDrawerContext } from '#/components/form-drawer'
import { SegmentedControl } from '#/components/segmented-control'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

// The app's form kit, built on TanStack Form's `createFormHook`. Forms call `useAppForm` and
// render fields as `<form.AppField name="email">{(f) => <f.TextField label="E-post" />}</…>`
// and their submit button as `<form.AppForm><form.SubmitButton>…</form.SubmitButton></…>`.
// Every field gets its own id, so a form can safely appear more than once on a page.

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts()

/** The field's first validation error, if any. For custom fields inside `form.AppField`. */
export function FieldError() {
  const field = useFieldContext<unknown>()
  const [error] = useStore(field.store, (s) => s.meta.errors)
  if (!error) return null
  return (
    <p className="text-destructive text-sm">
      {typeof error === 'string' ? error : (error as { message: string }).message}
    </p>
  )
}

/** `{ monthly: 'Månadsvis' }` → `[{ value: 'monthly', label: 'Månadsvis' }]`, for select fields. */
export const optionsFrom = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))

/** "Telefon (valfritt)": a label with a muted note. */
export function Optional({ children }: { children: ReactNode }) {
  return (
    <span>
      {children} <span className="font-normal text-muted-foreground">{m.form_optional()}</span>
    </span>
  )
}

function TextField({
  label,
  type = 'text',
  placeholder,
  autoComplete,
  inputMode,
  hint,
}: {
  label: ReactNode
  type?: string
  placeholder?: string
  autoComplete?: string
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
  /** A short help line under the input. */
  hint?: ReactNode
}) {
  const field = useFieldContext<string>()
  const id = useId()
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
      <FieldError />
    </div>
  )
}

function SelectField({
  label,
  options,
  placeholder,
  disabled,
}: {
  label: ReactNode
  options: readonly { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
}) {
  const field = useFieldContext<string>()
  const id = useId()
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
      <FieldError />
    </div>
  )
}

/** A few options side by side. With `label`, a visible label sits above it. */
function SegmentedField({
  label,
  showLabel = false,
  options,
  disabled,
}: {
  label: string
  showLabel?: boolean
  options: readonly { value: string; label: string }[]
  disabled?: boolean
}) {
  const field = useFieldContext<string>()
  const name = useId()
  const control = (
    <SegmentedControl
      label={label}
      name={name}
      disabled={disabled}
      value={field.state.value}
      options={options}
      onChange={(v) => field.handleChange(v)}
    />
  )
  if (!showLabel) return control
  return (
    <div className="grid gap-1.5">
      <span aria-hidden="true" className="font-medium text-sm">
        {label}
      </span>
      {control}
    </div>
  )
}

/** A yes/no setting: label and explanation on the left, the switch on the right. */
function SwitchField({
  label,
  description,
  disabled,
}: {
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  const field = useFieldContext<boolean>()
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description && <span className="text-muted-foreground text-xs">{description}</span>}
      </div>
      <Switch
        id={id}
        disabled={disabled}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
      />
    </div>
  )
}

/**
 * The form's submit button. Inside a `FormDrawer` it sits in a footer that stays visible while
 * the form scrolls, and it tells the drawer about unsaved changes and saving in progress.
 */
function SubmitButton({
  children,
  variant,
  className,
}: {
  children: ReactNode
  variant?: 'default' | 'destructive'
  className?: string
}) {
  const form = useFormContext()
  const drawer = useFormDrawerContext()
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting)
  const changed = useStore(form.store, (s) => !s.isDefaultValue)
  useEffect(
    () => drawer?.report({ changed, submitting: isSubmitting }),
    [drawer, changed, isSubmitting],
  )

  const button = (
    <Button
      type="submit"
      variant={variant}
      disabled={isSubmitting}
      className={cn(
        drawer ? 'h-11 w-full sm:h-10' : 'h-11 w-full sm:h-9 sm:w-auto sm:justify-self-start',
        className,
      )}
    >
      {children}
    </Button>
  )
  if (!drawer) return button
  return (
    <div className="sticky bottom-0 -mx-5 -mb-5 border-t bg-background px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      {button}
    </div>
  )
}

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, SelectField, SegmentedField, SwitchField },
  formComponents: { SubmitButton },
})
