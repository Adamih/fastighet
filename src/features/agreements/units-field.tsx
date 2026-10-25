import { FieldError, useFieldContext } from '#/components/form'
import { type UnitKind, unitKindLabels } from '#/features/properties/unit-kinds'

/**
 * The units an agreement covers, as checkboxes. Render inside `form.AppField` for a `string[]`
 * field; shared by the lease and bostadsrätt forms.
 */
export function UnitsField({
  label,
  hint,
  units,
}: {
  label: string
  hint?: string
  units: readonly { id: string; label: string; kind: UnitKind; designation: string }[]
}) {
  const field = useFieldContext<string[]>()
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-medium text-sm">{label}</legend>
      <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-3">
        {units.map((u) => (
          <label key={u.id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={field.state.value.includes(u.id)}
              onChange={(e) =>
                field.handleChange(
                  e.target.checked
                    ? [...field.state.value, u.id]
                    : field.state.value.filter((id) => id !== u.id),
                )
              }
            />
            <span>
              {u.designation} · <span className="font-medium">{u.label}</span>{' '}
              <span className="text-muted-foreground">({unitKindLabels[u.kind]})</span>
            </span>
          </label>
        ))}
      </div>
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      <FieldError />
    </fieldset>
  )
}
