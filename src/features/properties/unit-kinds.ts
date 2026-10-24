import { m } from '#/paraglide/messages'
export const unitKinds = ['apartment', 'commercial', 'parking', 'storage'] as const
export type UnitKind = (typeof unitKinds)[number]

export const unitKindLabels: Record<UnitKind, string> = {
  get apartment() {
    return m.unit_kind_apartment()
  },
  get commercial() {
    return m.unit_kind_commercial()
  },
  get parking() {
    return m.unit_kind_parking()
  },
  get storage() {
    return m.unit_kind_storage()
  },
}
