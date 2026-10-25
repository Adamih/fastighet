import { X } from 'lucide-react'
import { FieldError, useFieldContext } from '#/components/form'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { equalShares, MAX_PARTIES, ownershipParties } from '#/features/agreements/parties'
import { m } from '#/paraglide/messages'

/** The form's owners: who, and their share as typed (whole percent). */
export type OwnerValue = { partyId: string; share: string }

export const toOwners = (owners: readonly OwnerValue[]) =>
  owners.map((o) => ({ partyId: o.partyId, sharePercent: Number(o.share.trim()) }))

/** Validates the owners field on submit: at least one owner and shares that add up to 100. */
export const ownersValidator = {
  onSubmit: ({ value }: { value: OwnerValue[] }) => {
    if (value.length === 0) return m.ownership_owners_required()
    const result = ownershipParties(toOwners(value), null)
    return result.ok ? undefined : m.ownership_shares_hint()
  },
}

/**
 * Owners of a bostadsrätt with their shares. Adding or removing an owner splits the shares
 * equally; each can then be adjusted. Render inside `form.AppField` for an `OwnerValue[]` field.
 */
export function OwnersField({
  label,
  tenants,
  onRemove,
}: {
  label: string
  tenants: readonly { id: string; name: string }[]
  /** Called with the removed owner, e.g. to reset who receives the avier. */
  onRemove?: (partyId: string) => void
}) {
  const field = useFieldContext<OwnerValue[]>()
  const owners = field.state.value
  const nameOf = (id: string) => tenants.find((t) => t.id === id)?.name ?? ''
  const available = tenants.filter((t) => !owners.some((o) => o.partyId === t.id))
  const withEqualShares = (ids: string[]) => {
    const shares = equalShares(ids.length)
    return ids.map((partyId, i) => ({ partyId, share: String(shares[i]) }))
  }
  const total = toOwners(owners).reduce((sum, o) => sum + (o.sharePercent || 0), 0)

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-medium text-sm">{label}</legend>
      {owners.length > 0 && (
        <ul className="grid gap-1.5">
          {owners.map((owner, index) => (
            <li
              key={owner.partyId}
              className="flex items-center gap-2 rounded-md border py-1 pr-1 pl-3 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{nameOf(owner.partyId)}</span>
              <Input
                aria-label={m.ownership_share_label({ name: nameOf(owner.partyId) })}
                inputMode="numeric"
                value={owner.share}
                onChange={(e) =>
                  field.handleChange(
                    owners.map((o, i) => (i === index ? { ...o, share: e.target.value } : o)),
                  )
                }
                className="h-11 w-16 text-right tabular-nums sm:h-8"
              />
              <span className="text-muted-foreground">%</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-8"
                aria-label={m.ownership_remove_owner({ name: nameOf(owner.partyId) })}
                onClick={() => {
                  field.handleChange(
                    withEqualShares(
                      owners.filter((o) => o.partyId !== owner.partyId).map((o) => o.partyId),
                    ),
                  )
                  onRemove?.(owner.partyId)
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && owners.length < MAX_PARTIES && (
        // Picking a name adds it; the picker then resets to its placeholder.
        <Select
          value=""
          onValueChange={(id) =>
            field.handleChange(withEqualShares([...owners.map((o) => o.partyId), id]))
          }
        >
          <SelectTrigger
            aria-label={m.ownership_add_owner()}
            className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9"
          >
            <SelectValue placeholder={m.ownership_add_owner()} />
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
      <p className="text-muted-foreground text-sm">
        {owners.length > 1
          ? `${m.ownership_shares_hint()} ${m.ownership_shares_sum({ percent: total })}`
          : m.ownership_shares_hint()}
      </p>
      <FieldError />
    </fieldset>
  )
}
