import { useId } from 'react'
import { SegmentedControl } from '#/components/segmented-control'
import {
  type AccessLevel,
  type Grant,
  type GrantableResource,
  type GrantLevels,
  type GrantPreset,
  grantableResources,
  grantFromLevels,
  grantPresets,
  levelsFromGrant,
  presetOf,
} from '#/lib/managed-access'
import type { AssignmentRole } from '#/lib/permissions'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export const resourceLabel: Record<GrantableResource, () => string> = {
  property: m.grant_resource_property,
  tenant: m.grant_resource_tenant,
  lease: m.grant_resource_lease,
  invoice: m.grant_resource_invoice,
  payment: m.grant_resource_payment,
  settings: m.grant_resource_settings,
  bookkeeping: m.grant_resource_bookkeeping,
}

const levelLabel: Record<AccessLevel, () => string> = {
  none: m.grant_level_none,
  read: m.grant_level_read,
  manage: m.grant_level_manage,
}

export const presetLabel: Record<GrantPreset, () => string> = {
  full: m.grant_preset_full,
  finance: m.grant_preset_finance,
  readOnly: m.grant_preset_readOnly,
}

const presetHint: Record<GrantPreset, () => string> = {
  full: m.grant_preset_full_hint,
  finance: m.grant_preset_finance_hint,
  readOnly: m.grant_preset_readOnly_hint,
}

export const assignmentRoleLabel: Record<AssignmentRole, () => string> = {
  admin: m.assignment_role_admin,
  member: m.assignment_role_member,
  viewer: m.assignment_role_viewer,
}

export const presetLevels = (preset: GrantPreset) => levelsFromGrant(grantPresets[preset])

/** "Full förvaltning", or for other grants what may be done: "Avier: hantera · Avtal: se". */
export function grantSummary(grant: Grant) {
  const preset = presetOf(grant)
  if (preset) return presetLabel[preset]()
  const levels = levelsFromGrant(grant)
  return grantableResources
    .filter((r) => levels[r] !== 'none')
    .map((r) => `${resourceLabel[r]()}: ${levelLabel[levels[r]]().toLowerCase()}`)
    .join(' · ')
}

/** Presets on top, then one choice per resource. Used for asking, approving and changing. */
export function GrantLevelsEditor({
  value,
  onChange,
  disabled,
}: {
  value: GrantLevels
  onChange: (value: GrantLevels) => void
  disabled?: boolean
}) {
  const name = useId()
  const current = presetOf(grantFromLevels(value))
  return (
    <div className="grid gap-4">
      <fieldset disabled={disabled} className="grid gap-2">
        <legend className="mb-1.5 font-medium text-sm">{m.grant_preset_label()}</legend>
        {(Object.keys(grantPresets) as GrantPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={current === preset}
            onClick={() => onChange(presetLevels(preset))}
            className={cn(
              'grid gap-0.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
              current === preset ? 'border-primary bg-primary/5' : 'hover:bg-muted',
            )}
          >
            <span className="font-medium">{presetLabel[preset]()}</span>
            <span className="text-muted-foreground text-xs">{presetHint[preset]()}</span>
          </button>
        ))}
        {current === null && (
          <p className="text-muted-foreground text-xs">{m.grant_preset_custom()}</p>
        )}
      </fieldset>
      <div className="grid gap-3">
        {grantableResources.map((resource) => (
          <div
            key={resource}
            className="grid gap-1.5 @sm/form-drawer:grid-cols-[minmax(0,1fr)_14rem] @sm/form-drawer:items-center"
          >
            <span className="font-medium text-sm">{resourceLabel[resource]()}</span>
            <SegmentedControl
              label={resourceLabel[resource]()}
              name={`${name}-${resource}`}
              disabled={disabled}
              value={value[resource]}
              options={(['none', 'read', 'manage'] as const).map((level) => ({
                value: level,
                label: levelLabel[level](),
              }))}
              onChange={(level) => onChange({ ...value, [resource]: level })}
            />
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{m.grant_never()}</p>
    </div>
  )
}
