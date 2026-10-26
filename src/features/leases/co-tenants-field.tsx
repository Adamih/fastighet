import { X } from 'lucide-react'
import { Optional, useFieldContext } from '#/components/form'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { MAX_PARTIES } from '#/features/agreements/parties'
import { m } from '#/paraglide/messages'

/**
 * Co-tenants on a lease: added by picking a name, removed with ✕. Render inside `form.AppField`
 * for a `string[]` field. The tenant (`tenantId`) is never offered or kept as a co-tenant.
 */
export function CoTenantsField({
  tenants,
  tenantId,
  onRemove,
}: {
  tenants: readonly { id: string; name: string }[]
  tenantId: string
  /** Called with the removed co-tenant, e.g. to reset who receives the avier. */
  onRemove?: (id: string) => void
}) {
  const field = useFieldContext<string[]>()
  const nameOf = (id: string) => tenants.find((t) => t.id === id)?.name ?? ''
  const chosen = field.state.value.filter((id) => id !== tenantId)
  const available = tenants.filter((t) => t.id !== tenantId && !chosen.includes(t.id))
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-medium text-sm">
        <Optional>{m.lease_form_co_tenants()}</Optional>
      </legend>
      {chosen.length > 0 && (
        <ul className="grid gap-1.5">
          {chosen.map((id) => (
            <li
              key={id}
              className="flex items-center justify-between gap-2 rounded-md border py-1 pr-1 pl-3 text-sm"
            >
              <span className="truncate">{nameOf(id)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-8"
                aria-label={m.lease_form_remove_co_tenant({ name: nameOf(id) })}
                onClick={() => {
                  field.handleChange(field.state.value.filter((other) => other !== id))
                  onRemove?.(id)
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && chosen.length < MAX_PARTIES - 1 && (
        // Picking a name adds it; the picker then resets to its placeholder.
        <Select value="" onValueChange={(id) => field.handleChange([...chosen, id])}>
          <SelectTrigger
            aria-label={m.lease_form_add_co_tenant()}
            className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9"
          >
            <SelectValue placeholder={m.lease_form_add_co_tenant()} />
          </SelectTrigger>
          <SelectContent>
            {available.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-muted-foreground text-sm">{m.lease_form_co_tenants_hint()}</p>
    </fieldset>
  )
}

/** The choices for who receives the avier: the tenant first, then the co-tenants. */
export const receiverOptions = (
  tenantId: string,
  coTenantIds: readonly string[],
  tenants: readonly { id: string; name: string }[],
) =>
  [...new Set([tenantId, ...coTenantIds])].filter(Boolean).map((id) => ({
    value: id,
    label: tenants.find((t) => t.id === id)?.name ?? '',
  }))
